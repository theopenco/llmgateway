import type { SessionProviderStore } from "@llmgateway/actions";

/**
 * A soft rate limit still routes new traffic away, but a session already pinned
 * to the capped provider keeps it. Returns that provider when the session's pin
 * is one of the soft-limited providers. The pin is only read when a soft limit
 * is actually hit, so uncapped requests pay no extra Redis round trip.
 */
export async function resolveSoftLimitExemptProvider(
	store: SessionProviderStore | undefined,
	softLimitedProviderIds: Set<string>,
): Promise<string | undefined> {
	if (!store || softLimitedProviderIds.size === 0) {
		return undefined;
	}
	const pinned = await store.get();
	return pinned && softLimitedProviderIds.has(pinned.providerId)
		? pinned.providerId
		: undefined;
}
