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
