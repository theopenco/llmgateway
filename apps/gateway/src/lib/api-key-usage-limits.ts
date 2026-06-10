import { HTTPException } from "hono/http-exception";

import {
	getApiKeyCurrentPeriodState,
	type InferSelectModel,
} from "@llmgateway/db";

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
