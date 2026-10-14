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
 * When no organization key could be selected for a provider, tell keys at
 * their own rate limits apart from a missing key: when caps alone emptied the
 * pool the selection drew from, the request gets a retryable 429.
 */
export async function assertProviderKeysNotRateLimited(
	organizationId: string,
	provider: string,
	options: {
		customProviderName?: string;
		filter?: (key: InferSelectModel<typeof tables.providerKey>) => boolean;
		excludedKeyIds?: ReadonlySet<string>;
	} = {},
): Promise<void> {
	const listed =
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
	const candidates = listed.filter(
		(key) => !options.excludedKeyIds?.has(key.id),
	);
	const limited = await getRateLimitedProviderKeys(candidates);
	if (candidates.length > 0 && limited.size === candidates.length) {
		throw new ProviderKeyRateLimitError(
			`Every API key for provider ${options.customProviderName ?? provider} is at its configured rate limit. Please try again later.`,
			limited,
		);
	}
}
