import { randomUUID } from "node:crypto";

import { logger } from "@llmgateway/logger";

import {
	addTokenWindowEntry,
	addWindowEntry,
	PROVIDER_RATE_LIMIT_WINDOWS,
	providerRateLimitWindows,
	readRequestWindow,
	readTokenWindow,
	type ProviderRateLimitWindow,
} from "./rate-limit-windows.js";

/** The per-credential caps a `provider_key` row carries. */
export interface ProviderKeyRateLimits {
	id: string;
	maxRpm: number | null;
	maxRpd: number | null;
	maxTpm: number | null;
	maxTpd: number | null;
}

function getKeyWindowLimit(
	key: ProviderKeyRateLimits,
	window: ProviderRateLimitWindow,
): number | null {
	switch (window) {
		case "rpm":
			return key.maxRpm;
		case "rpd":
			return key.maxRpd;
		case "tpm":
			return key.maxTpm;
		case "tpd":
			return key.maxTpd;
	}
}

function configuredWindows(
	key: ProviderKeyRateLimits,
): Array<{ window: ProviderRateLimitWindow; limit: number }> {
	return PROVIDER_RATE_LIMIT_WINDOWS.flatMap((window) => {
		const limit = getKeyWindowLimit(key, window);
		return limit !== null && limit > 0 ? [{ window, limit }] : [];
	});
}

export function hasProviderKeyRateLimits(key: ProviderKeyRateLimits): boolean {
	return configuredWindows(key).length > 0;
}

function getProviderKeyRateLimitKey(
	providerKeyId: string,
	window: ProviderRateLimitWindow,
): string {
	return `rate_limit:provider_key:${providerRateLimitWindows[window].redisSuffix}:${providerKeyId}`;
}

/**
 * Windows at which a provider key is currently capped. Read-only. Fails open
 * (no windows) on Redis errors so a limiter outage never takes keys offline.
 */
export async function getProviderKeyBlockedWindows(
	key: ProviderKeyRateLimits,
): Promise<ProviderRateLimitWindow[]> {
	const windows = configuredWindows(key);
	if (windows.length === 0) {
		return [];
	}
	try {
		const now = Date.now();
		const states = await Promise.all(
			windows.map(async ({ window, limit }) => {
				const read =
					providerRateLimitWindows[window].unit === "tokens"
						? readTokenWindow
						: readRequestWindow;
				const state = await read(
					getProviderKeyRateLimitKey(key.id, window),
					window,
					limit,
					now,
					"none",
					"strict",
				);
				return { window, rateLimited: state.rateLimited };
			}),
		);
		return states
			.filter((state) => state.rateLimited)
			.map((state) => state.window);
	} catch (error) {
		logger.error("Error reading provider key rate limit:", error as Error);
		return [];
	}
}

/**
 * Ids of the given provider keys that are at one of their own RPM/RPD/TPM/TPD
 * caps. Only keys with a cap configured touch Redis.
 */
export async function getRateLimitedProviderKeyIds(
	keys: readonly ProviderKeyRateLimits[],
): Promise<Set<string>> {
	const capped = keys.filter(hasProviderKeyRateLimits);
	if (capped.length === 0) {
		return new Set();
	}
	const blocked = await Promise.all(
		capped.map(async (key) => ({
			id: key.id,
			blocked: (await getProviderKeyBlockedWindows(key)).length > 0,
		})),
	);
	return new Set(blocked.filter((key) => key.blocked).map((key) => key.id));
}

/** The given keys minus those currently at one of their own caps. */
export async function excludeRateLimitedProviderKeys<
	T extends ProviderKeyRateLimits,
>(keys: T[]): Promise<T[]> {
	const limited = await getRateLimitedProviderKeyIds(keys);
	return limited.size === 0 ? keys : keys.filter((key) => !limited.has(key.id));
}

/**
 * Count one served request and its prompt + completion tokens against a
 * provider key's caps. Recorded when the request is logged, so the caps are
 * post-paid: in-flight requests are not yet counted. Swallows its own errors
 * so logging is never blocked.
 */
export async function recordProviderKeyUsage(
	key: ProviderKeyRateLimits,
	tokens: number,
): Promise<void> {
	const windows = configuredWindows(key);
	if (windows.length === 0) {
		return;
	}
	try {
		const now = Date.now();
		const member = `${now}:${randomUUID()}`;
		await Promise.all(
			windows.map(async ({ window }) => {
				const redisKey = getProviderKeyRateLimitKey(key.id, window);
				if (providerRateLimitWindows[window].unit === "requests") {
					await addWindowEntry(redisKey, window, now, member);
				} else if (tokens > 0) {
					await addTokenWindowEntry(redisKey, window, now, tokens);
				}
			}),
		);
	} catch (error) {
		logger.error("Error recording provider key usage:", error as Error);
	}
}
