import { Decimal } from "decimal.js";

import {
	assertApiKeyWithinUsageLimits,
	assertMemberProjectAccess,
	assertMemberWithinBudget,
} from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
} from "@/lib/cached-queries.js";
import { assertProviderCompliant } from "@/lib/compliance.js";
import { validateRequestModelAccess } from "@/lib/iam.js";
import { getOrganizationBlockReason } from "@/lib/organization-access.js";
import { checkSpendLimit } from "@/lib/spend-limit.js";

import { logger } from "@llmgateway/logger";

import { getUnsettledRealtimeOrganizationSpend } from "./billing.js";
import { getAvailableCredits } from "./preflight.js";

import type { RealtimeMappingMatch } from "./catalog.js";
import type { RealtimePreflightResult } from "./preflight.js";

type AccountOrganization = Awaited<ReturnType<typeof findOrganizationById>>;

export type AuthorizeAccountResult =
	| { ok: true; organization: NonNullable<AccountOrganization> }
	| {
			ok: false;
			code: string;
			message: string;
			severity: "transient" | "deny" | "close";
	  };

export interface AuthorizeAccountInput {
	preflight: RealtimePreflightResult;
	gatewayToken: string;
	/**
	 * Model string the caller requested, used for compliance audit context.
	 */
	requestedModel: string;
	/**
	 * Catalogue mapping the billable unit of work runs against. This is the
	 * session's realtime mapping for generations and the pinned ASR mapping for
	 * transcription re-checks.
	 */
	match: RealtimeMappingMatch;
}

/**
 * Account-level authorization for one billable unit of work against `match`:
 * fresh key/org/project state, per-key usage limits, IAM access to the model,
 * the org's compliance policy, and the member's spend budget. Shared by every
 * realtime session implementation so each provider reacts to a revoked key,
 * budget or model within one turn.
 *
 * `severity` tells the caller what a failure means: "transient" when the
 * state could not be read at all, "deny" when only this unit of work is
 * refused, "close" when the session must not continue.
 */
export async function authorizeAccount(
	input: AuthorizeAccountInput,
): Promise<AuthorizeAccountResult> {
	const { preflight, match } = input;
	let freshKey;
	let freshOrg;
	let freshProject;
	try {
		freshKey = await findApiKeyByToken(input.gatewayToken);
		freshOrg = await findOrganizationById(preflight.project.organizationId);
		freshProject = await findProjectById(preflight.project.id);
	} catch (error) {
		logger.error("Realtime authorization lookup failed", error as Error);
		return {
			ok: false,
			code: "gate_unavailable",
			message:
				"Unable to verify account state; generation is temporarily unavailable.",
			severity: "transient",
		};
	}

	if (!freshKey || freshKey.status !== "active") {
		return {
			ok: false,
			code: "api_key_revoked",
			message: "The LLMGateway API key for this session is no longer active.",
			severity: "close",
		};
	}
	try {
		assertApiKeyWithinUsageLimits(freshKey);
	} catch (error) {
		return {
			ok: false,
			code: "api_key_limit",
			message:
				error instanceof Error ? error.message : "API key usage limit reached.",
			severity: "deny",
		};
	}

	if (!freshOrg || getOrganizationBlockReason(freshOrg)) {
		return {
			ok: false,
			code: "organization_unavailable",
			message: "The organization for this session is no longer active.",
			severity: "close",
		};
	}

	if (!freshProject || freshProject.status === "deleted") {
		return {
			ok: false,
			code: "project_archived",
			message: "The project for this session has been archived.",
			severity: "close",
		};
	}

	// IAM rules and the organization's compliance policy can change while a
	// session is open, and a session may live for the whole duration limit.
	// Re-evaluating them per billable unit makes a revoked model, IP range or
	// provider take effect within one turn, as it would for HTTP requests.
	const iamValidation = await validateRequestModelAccess({
		apiKey: freshKey,
		organizationId: preflight.project.organizationId,
		requestedModel: match.modelId,
		requestedProvider: match.mapping.providerId,
		activeModelInfo: match.modelDef,
		clientIp: preflight.clientIp,
	});
	if (!iamValidation.allowed) {
		return {
			ok: false,
			code: "model_access_denied",
			message: iamValidation.reason ?? "Model access denied.",
			severity: "close",
		};
	}
	try {
		await assertProviderCompliant(freshOrg, match.mapping.providerId, {
			organizationId: preflight.project.organizationId,
			modelId: match.modelId,
			apiKeyId: freshKey.id,
			model: input.requestedModel,
		});
	} catch (error) {
		return {
			ok: false,
			code: "compliance_blocked",
			message:
				error instanceof Error
					? error.message
					: "This provider is blocked by the organization's compliance policy.",
			severity: "close",
		};
	}

	try {
		await assertMemberProjectAccess(freshKey, preflight.project.organizationId);
	} catch (error) {
		return {
			ok: false,
			code: "project_access_revoked",
			message:
				error instanceof Error
					? error.message
					: "Project access has been revoked.",
			severity: "close",
		};
	}

	try {
		await assertMemberWithinBudget(
			freshKey.createdBy,
			preflight.project.organizationId,
		);
	} catch (error) {
		return {
			ok: false,
			code: "member_budget_exceeded",
			message:
				error instanceof Error ? error.message : "Member spend budget reached.",
			severity: "deny",
		};
	}

	// Per-org daily/monthly spend caps: realtime billing advances the same
	// Redis counters as every other credits-billed path, and this gate is what
	// makes a reached cap actually reject the next billable turn. Wallet-funded
	// sessions bill the wallet, not the org, so they are exempt like elsewhere.
	if (preflight.usedMode === "credits" && !freshKey.endCustomerWalletId) {
		const spendLimit = await checkSpendLimit(freshOrg);
		if (!spendLimit.allowed) {
			return {
				ok: false,
				code: "spend_cap_reached",
				message: `Organization ${freshOrg.id} has reached its ${spendLimit.period} spend limit of $${spendLimit.limit}. Try again later or contact support to raise your limit.`,
				severity: "deny",
			};
		}
	}

	return { ok: true, organization: freshOrg };
}

/**
 * Credits still available to a session: the organization's balance minus its
 * realtime spend the worker has NOT yet settled (once the worker debits a row
 * the organization balance already reflects it, so subtracting it again would
 * double-count). The unsettled sum spans the organization's sessions, not just
 * one, so concurrent sessions cannot each authorize work against the same
 * undebited balance. Null when billing state is unreadable.
 */
export async function availableCredits(
	organizationId: string,
	organization: Parameters<typeof getAvailableCredits>[0],
): Promise<Decimal | null> {
	const unsettled = await getUnsettledRealtimeOrganizationSpend(
		organizationId,
	).catch((error: unknown) => {
		logger.error(
			"Failed to read unsettled realtime organization spend",
			error as Error,
		);
		return null;
	});
	if (unsettled === null) {
		return null;
	}
	return new Decimal(getAvailableCredits(organization)).minus(unsettled);
}
