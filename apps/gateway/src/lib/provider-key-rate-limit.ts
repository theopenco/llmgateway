import { randomUUID } from "node:crypto";

import { HTTPException } from "hono/http-exception";

import { logger } from "@llmgateway/logger";

import {
	addTokenWindowEntry,
	addWindowEntry,
	isRateLimitExempt,
	PROVIDER_RATE_LIMIT_WINDOWS,
	providerRateLimitWindows,
	readRequestWindow,
	readTokenWindow,
	type ProviderRateLimitExemption,
	type ProviderRateLimitWindow,
} from "./rate-limit-windows.js";

import type { RateLimitMode } from "@llmgateway/db";

/** The per-credential caps a `provider_key` row carries. */
export interface ProviderKeyRateLimits {
	id: string;
	provider: string;
	maxRpm: number | null;
	maxRpd: number | null;
	maxTpm: number | null;
	maxTpd: number | null;
	/** Same semantics as `rate_limit.mode`, applied to every window. */
	rateLimitMode: RateLimitMode;
}

/**
 * The request's exemption from soft/lax key caps, per provider: a session is
 * pinned to one provider, so only that provider's keys may be exempt.
 */
export type ProviderKeyRateLimitExemption = (
	provider: string,
) => ProviderRateLimitExemption;

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
 * Seconds until a provider key is below every one of its caps again, or
 * undefined when it is not capped. Read-only. Fails open (not capped) on Redis
 * errors so a limiter outage never takes keys offline.
 */
async function getProviderKeyRetryAfter(
	key: ProviderKeyRateLimits,
): Promise<number | undefined> {
	const windows = configuredWindows(key);
	if (windows.length === 0) {
		return undefined;
	}
	try {
		const now = Date.now();
		const states = await Promise.all(
			windows.map(async ({ window, limit }) => {
				const read =
					providerRateLimitWindows[window].unit === "tokens"
						? readTokenWindow
						: readRequestWindow;
				return await read(
					getProviderKeyRateLimitKey(key.id, window),
					window,
					limit,
					now,
					"none",
					"strict",
				);
			}),
		);
		const blocked = states.filter((state) => state.rateLimited);
		return blocked.length === 0
			? undefined
			: Math.max(
					1,
					...blocked.map(
						(state) => state.retryAfter ?? providerRateLimitWindows.rpd.seconds,
					),
				);
	} catch (error) {
		logger.error("Error reading provider key rate limit:", error as Error);
		return undefined;
	}
}

/**
 * The given provider keys that are at one of their own RPM/RPD/TPM/TPD caps,
 * mapped to the seconds until each is usable again. A soft or lax key the
 * request is exempt from never counts as capped. Only keys with a cap
 * configured touch Redis.
 */
export async function getRateLimitedProviderKeys(
	keys: readonly ProviderKeyRateLimits[],
	exemption?: ProviderKeyRateLimitExemption,
): Promise<Map<string, number>> {
	const capped = keys.filter(
		(key) =>
			hasProviderKeyRateLimits(key) &&
			!(
				exemption &&
				isRateLimitExempt(key.rateLimitMode, exemption(key.provider))
			),
	);
	if (capped.length === 0) {
		return new Map();
	}
	const results = await Promise.all(
		capped.map(async (key) => ({
			id: key.id,
			retryAfter: await getProviderKeyRetryAfter(key),
		})),
	);
	const limited = new Map<string, number>();
	for (const { id, retryAfter } of results) {
		if (retryAfter !== undefined) {
			limited.set(id, retryAfter);
		}
	}
	return limited;
}

export async function getRateLimitedProviderKeyIds(
	keys: readonly ProviderKeyRateLimits[],
	exemption?: ProviderKeyRateLimitExemption,
): Promise<Set<string>> {
	return new Set((await getRateLimitedProviderKeys(keys, exemption)).keys());
}

/**
 * Every key that could serve the request is at one of its own caps. Carries
 * the seconds until the first of them frees up for the `Retry-After` header.
 */
export class ProviderKeyRateLimitError extends HTTPException {
	public readonly retryAfter: number | undefined;

	public constructor(message: string, limited: ReadonlyMap<string, number>) {
		super(429, { message });
		this.retryAfter =
			limited.size > 0 ? Math.min(...limited.values()) : undefined;
	}
}

/** The given keys minus those currently at one of their own caps. */
export async function excludeRateLimitedProviderKeys<
	T extends ProviderKeyRateLimits,
>(keys: T[], exemption?: ProviderKeyRateLimitExemption): Promise<T[]> {
	const limited = await getRateLimitedProviderKeyIds(keys, exemption);
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
