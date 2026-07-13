import { HTTPException } from "hono/http-exception";

import {
	getApiKeyCurrentPeriodState,
	isApiKeyPeriodLimitConfigured,
	resolveEffectiveMemberBudget,
	type InferSelectModel,
} from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";

import {
	findOrganizationById,
	findUserOrganizationBudget,
	getMemberKeyUsage,
	getMemberPeriodSpend,
} from "./cached-queries.js";

import type { tables } from "@llmgateway/db";

type ApiKey = InferSelectModel<typeof tables.apiKey>;

export function assertApiKeyWithinUsageLimits(
	apiKey: ApiKey,
	now: Date = new Date(),
): void {
	// Enforce the key's TTL immediately, even before the worker flips an expired
	// key to "inactive". End-user session principals carry their own session
	// expiry and are validated separately, so only guard developer keys here.
	if (
		apiKey.keyType === "user" &&
		apiKey.expiresAt &&
		apiKey.expiresAt.getTime() <= now.getTime()
	) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: LLMGateway API key has expired. Set a new expiration date to reactivate it.",
		});
	}

	if (apiKey.usageLimit && Number(apiKey.usage) >= Number(apiKey.usageLimit)) {
		throw new HTTPException(401, {
			message: "Unauthorized: LLMGateway API key reached its usage limit.",
		});
	}

	const currentPeriod = getApiKeyCurrentPeriodState(apiKey, now);

	if (
		apiKey.periodUsageLimit &&
		Number(currentPeriod.usage) >= Number(apiKey.periodUsageLimit)
	) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: LLMGateway API key reached its current period usage limit.",
		});
	}
}

/**
 * Enforce the per-member budget set on the Teams page. Reads spend from the
 * durable per-key sources (apiKey.usage + apiKeyHourlyStats.cost) through the
 * SWR cache, so it fails OPEN: a cold cache during a Postgres outage must not
 * block traffic. Only a confirmed over-budget read (an HTTPException) rejects.
 *
 * Budgets are soft caps — served through a short-lived cache and computed from
 * worker-maintained/hourly-rolled data — so a small overspend is possible, the
 * same semantics as the per-key limits above. Uses HTTP 403 (distinct from the
 * per-key 401 and the org-credit 402).
 */
export async function assertMemberWithinBudget(
	userId: string,
	organizationId: string,
	now: Date = new Date(),
): Promise<void> {
	try {
		const memberBudget = await findUserOrganizationBudget(
			userId,
			organizationId,
		);
		if (!memberBudget) {
			return;
		}

		// The org-wide default developer budget is the fallback; the member's own
		// values override it field by field.
		const org = await findOrganizationById(organizationId);
		const budget = resolveEffectiveMemberBudget(
			memberBudget.role,
			memberBudget,
			{
				defaultDeveloperMaxApiKeys: org?.defaultDeveloperMaxApiKeys ?? null,
				defaultDeveloperUsageLimit: org?.defaultDeveloperUsageLimit ?? null,
				defaultDeveloperPeriodUsageLimit:
					org?.defaultDeveloperPeriodUsageLimit ?? null,
				defaultDeveloperPeriodUsageDurationValue:
					org?.defaultDeveloperPeriodUsageDurationValue ?? null,
				defaultDeveloperPeriodUsageDurationUnit:
					org?.defaultDeveloperPeriodUsageDurationUnit ?? null,
			},
		);

		if (!budget.usageLimit && !budget.periodUsageLimit) {
			return;
		}

		const { keyIds, lifetimeUsage } = await getMemberKeyUsage(
			userId,
			organizationId,
		);

		if (budget.usageLimit && lifetimeUsage >= Number(budget.usageLimit)) {
			throw new HTTPException(403, {
				message: "Member has reached their total spend budget.",
			});
		}

		if (isApiKeyPeriodLimitConfigured(budget) && keyIds.length) {
			const spend = await getMemberPeriodSpend(
				organizationId,
				userId,
				keyIds,
				budget.periodUsageDurationUnit,
				budget.periodUsageDurationValue,
				now,
			);
			if (spend >= Number(budget.periodUsageLimit)) {
				throw new HTTPException(403, {
					message: "Member has reached their period spend budget.",
				});
			}
		}
	} catch (e) {
		if (e instanceof HTTPException) {
			throw e;
		}
		// Fail open, but log the underlying error so a genuine bug here (vs. an
		// expected transient DB/cache outage) is diagnosable rather than silent.
		logger.error(
			"member budget check unavailable, allowing request",
			toError(e),
			{
				userId,
				organizationId,
			},
		);
	}
}
