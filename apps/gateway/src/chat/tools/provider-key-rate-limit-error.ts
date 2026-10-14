import { HTTPException } from "hono/http-exception";

import { listEligibleProviderKeys } from "@/lib/cached-queries.js";
import { getRateLimitedProviderKeyIds } from "@/lib/provider-key-rate-limit.js";

import type { InferSelectModel, tables } from "@llmgateway/db";

/**
 * When no organization key could be selected for a provider, tell a key at its
 * own rate limit apart from a missing key: the former is a retryable 429.
 */
export async function assertProviderKeysNotRateLimited(
	organizationId: string,
	provider: string,
	filter?: (key: InferSelectModel<typeof tables.providerKey>) => boolean,
): Promise<void> {
	if (provider === "custom") {
		return;
	}
	const keys = await listEligibleProviderKeys(organizationId, provider, filter);
	if ((await getRateLimitedProviderKeyIds(keys)).size > 0) {
		throw new HTTPException(429, {
			message: `Every API key for provider ${provider} is at its configured rate limit. Please try again later.`,
		});
	}
}
