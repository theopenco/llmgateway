/**
 * Embeddable SDK: shared helpers for billing requests authenticated with an
 * ephemeral end-user session token (`es_…`) to the bound wallet instead of the
 * developer's organization credits.
 *
 * The approach (see apps/gateway/src/chat/chat.ts for the canonical use): an
 * end-user session presents the project's hidden embedded-session aggregate key
 * as the effective API key, plus request-local session metadata. The effective
 * project is forced to `credits` mode and organization credits mirror the
 * wallet balance, so existing credit gating bills the wallet. Logs keep the
 * aggregate apiKeyId while endCustomerWalletId/endUserSessionId preserve the
 * actual end-user owner.
 */
import { HTTPException } from "hono/http-exception";

import {
	models,
	type ModelDefinition,
	type ProviderId,
} from "@llmgateway/models";

import { findWalletById } from "./cached-queries.js";

import type { GatewayApiKey } from "./cached-queries.js";
import type { InferSelectModel } from "@llmgateway/db";
import type {
	organization as organizationTable,
	project as projectTable,
	wallet as walletTable,
} from "@llmgateway/db";
import type { Context } from "hono";

type Project = InferSelectModel<typeof projectTable>;
type Organization = InferSelectModel<typeof organizationTable>;
type Wallet = InferSelectModel<typeof walletTable>;

/**
 * Validate an ephemeral session key and load its wallet. Returns null for normal
 * developer keys. Throws on expired / unbound / frozen sessions.
 */
export async function loadEndUserWallet(
	apiKey: GatewayApiKey,
): Promise<Wallet | null> {
	if (!apiKey.endUserSession) {
		return null;
	}
	if (apiKey.endUserSession.expiresAt.getTime() < Date.now()) {
		throw new HTTPException(401, {
			message:
				"Ephemeral session expired. Mint a fresh session token from your backend.",
		});
	}
	if (apiKey.endUserSession.endCustomerStatus !== "active") {
		throw new HTTPException(401, { message: "End customer is inactive" });
	}
	if (apiKey.endUserSession.projectStatus !== "active") {
		throw new HTTPException(401, { message: "Project is inactive" });
	}
	if (apiKey.endUserSession.walletStatus !== "active") {
		throw new HTTPException(402, {
			message: "End-user wallet not found or frozen",
		});
	}
	if (!apiKey.endUserSession.walletId) {
		// An ephemeral token with no bound wallet is an invalid credential, not a
		// server fault.
		throw new HTTPException(401, {
			message: "Session token is not bound to a wallet",
		});
	}
	const wallet = await findWalletById(apiKey.endUserSession.walletId);
	if (!wallet || wallet.status !== "active") {
		throw new HTTPException(402, {
			message: "End-user wallet not found or frozen",
		});
	}
	return wallet;
}

export function validateEndUserSessionModelAccess(
	apiKey: GatewayApiKey,
	requestedModel: string,
	activeModelInfo?: ModelDefinition,
): {
	allowed: boolean;
	reason?: string;
	allowedProviders?: ProviderId[];
} | null {
	const scopeModels = apiKey.endUserSession?.scope?.models;
	if (!scopeModels) {
		return null;
	}

	const modelDef =
		activeModelInfo ?? models.find((model) => model.id === requestedModel);
	if (!modelDef) {
		return { allowed: false, reason: `Model ${requestedModel} not found` };
	}

	if (!scopeModels.includes(modelDef.id)) {
		return {
			allowed: false,
			reason: `Model ${modelDef.id} is not in the allowed models list`,
		};
	}

	return {
		allowed: true,
		allowedProviders: modelDef.providers.map((provider) => provider.providerId),
	};
}

/**
 * Defense-in-depth origin allowlist: if the project configured allowedOrigins,
 * reject browser requests from other origins.
 */
export function assertOriginAllowed(
	c: Pick<Context, "req">,
	project: Project,
): void {
	const origin = c.req.header("Origin");
	const allowed = project.allowedOrigins;
	if (origin && allowed && allowed.length > 0 && !allowed.includes(origin)) {
		throw new HTTPException(403, {
			message: "Origin not allowed for this project",
		});
	}
}

/** Force credits mode for an end-user session (never use the developer's BYO keys). */
export function withCreditsMode(project: Project): Project {
	return { ...project, mode: "credits" };
}

/**
 * Present the wallet balance as the organization's credits so downstream credit
 * gating evaluates the wallet, not the developer's org. Dev-plan credits are
 * zeroed so they can't subsidize end-user traffic. The real org row is untouched
 * — the worker debits the wallet.
 */
export function withWalletCredits(
	organization: Organization,
	wallet: Wallet,
): Organization {
	return {
		...organization,
		credits: wallet.balance,
		devPlan: "none",
		devPlanCreditsLimit: "0",
		devPlanCreditsUsed: "0",
	};
}

/**
 * Convenience composition for endpoints that load project + organization up
 * front and then run credit checks (embeddings, moderations). Returns the
 * effective project/organization plus the wallet (null for normal keys).
 */
export async function applyEndUserSession(
	c: Pick<Context, "req">,
	apiKey: GatewayApiKey,
	project: Project,
	organization: Organization,
): Promise<{
	project: Project;
	organization: Organization;
	wallet: Wallet | null;
}> {
	const wallet = await loadEndUserWallet(apiKey);
	if (!wallet) {
		return { project, organization, wallet: null };
	}
	assertOriginAllowed(c, project);
	return {
		project: withCreditsMode(project),
		organization: withWalletCredits(organization, wallet),
		wallet,
	};
}
