import {
	listCustomProviderKeys,
	listEligibleProviderKeys,
} from "@/lib/cached-queries.js";
import {
	getRateLimitedProviderKeys,
	ProviderKeyRateLimitError,
} from "@/lib/provider-key-rate-limit.js";

import type { InferSelectModel, tables } from "@llmgateway/db";

/**
 * When no organization key could be selected for a provider, tell a key at its
 * own rate limit apart from a missing key: the former is a retryable 429.
 */
export async function assertProviderKeysNotRateLimited(
	organizationId: string,
	provider: string,
	options: {
		customProviderName?: string;
		filter?: (key: InferSelectModel<typeof tables.providerKey>) => boolean;
	} = {},
): Promise<void> {
	const keys =
		provider === "custom"
			? options.customProviderName
				? await listCustomProviderKeys(
						organizationId,
						options.customProviderName,
					)
				: []
			: await listEligibleProviderKeys(
					organizationId,
					provider,
					options.filter,
				);
	const limited = await getRateLimitedProviderKeys(keys);
	if (limited.size > 0) {
		throw new ProviderKeyRateLimitError(
			`Every API key for provider ${options.customProviderName ?? provider} is at its configured rate limit. Please try again later.`,
			limited,
		);
	}
}
