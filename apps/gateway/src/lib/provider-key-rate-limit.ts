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

import type { ProviderKeyModelRateLimits, RateLimitMode } from "@llmgateway/db";

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
	/** Caps for single models, keyed by canonical model id, on top of the above. */
	modelRateLimits: ProviderKeyModelRateLimits | null;
}

/**
 * The request's exemption from soft/lax key caps, per provider: a session is
 * pinned to one provider, so only that provider's keys may be exempt.
 */
export type ProviderKeyRateLimitExemption = (
	provider: string,
) => ProviderRateLimitExemption;

interface WindowLimits {
	maxRpm?: number | null;
	maxRpd?: number | null;
	maxTpm?: number | null;
	maxTpd?: number | null;
}

interface ConfiguredWindow {
	window: ProviderRateLimitWindow;
	limit: number;
	redisKey: string;
}

function getWindowLimit(
	limits: WindowLimits,
	window: ProviderRateLimitWindow,
): number | null | undefined {
	switch (window) {
		case "rpm":
			return limits.maxRpm;
		case "rpd":
			return limits.maxRpd;
		case "tpm":
			return limits.maxTpm;
		case "tpd":
			return limits.maxTpd;
	}
}

function getProviderKeyRateLimitKey(
	providerKeyId: string,
	window: ProviderRateLimitWindow,
): string {
	return `rate_limit:provider_key:${providerRateLimitWindows[window].redisSuffix}:${providerKeyId}`;
}

function getProviderKeyModelRateLimitKey(
	providerKeyId: string,
	model: string,
	window: ProviderRateLimitWindow,
): string {
	return `rate_limit:provider_key_model:${providerRateLimitWindows[window].redisSuffix}:${providerKeyId}:${model}`;
}

function windowsOf(
	limits: WindowLimits,
	redisKey: (window: ProviderRateLimitWindow) => string,
): ConfiguredWindow[] {
	return PROVIDER_RATE_LIMIT_WINDOWS.flatMap((window) => {
		const limit = getWindowLimit(limits, window);
		return typeof limit === "number" && limit > 0
			? [{ window, limit, redisKey: redisKey(window) }]
			: [];
	});
}

function keyWideWindows(key: ProviderKeyRateLimits): ConfiguredWindow[] {
	return windowsOf(key, (window) => getProviderKeyRateLimitKey(key.id, window));
}

function modelWindows(
	key: ProviderKeyRateLimits,
	model: string | undefined,
): ConfiguredWindow[] {
	if (
		model === undefined ||
		!key.modelRateLimits ||
		!Object.hasOwn(key.modelRateLimits, model)
	) {
		return [];
	}
	return windowsOf(key.modelRateLimits[model], (window) =>
		getProviderKeyModelRateLimitKey(key.id, model, window),
	);
}

/**
 * The windows that cap a key for a request: its key-wide windows plus, when
 * the request's canonical model is known, that model's own windows.
 */
function configuredWindows(
	key: ProviderKeyRateLimits,
	model?: string,
): ConfiguredWindow[] {
	return [...keyWideWindows(key), ...modelWindows(key, model)];
}

/**
 * Seconds until a provider key is below every one of its caps again, or
 * undefined when it is not capped. Read-only. Fails open (not capped) on Redis
 * errors so a limiter outage never takes keys offline.
 */
async function getRetryAfter(
	windows: readonly ConfiguredWindow[],
): Promise<number | undefined> {
	if (windows.length === 0) {
		return undefined;
	}
	try {
		const now = Date.now();
		const states = await Promise.all(
			windows.map(async ({ window, limit, redisKey }) => {
				const read =
					providerRateLimitWindows[window].unit === "tokens"
						? readTokenWindow
						: readRequestWindow;
				return await read(redisKey, window, limit, now, "none", "strict");
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

async function getLimitedKeys(
	keys: readonly ProviderKeyRateLimits[],
	windowsFor: (key: ProviderKeyRateLimits) => ConfiguredWindow[],
	exemption: ProviderKeyRateLimitExemption | undefined,
): Promise<Map<string, number>> {
	const capped = keys.flatMap((key) => {
		const windows = windowsFor(key);
		return windows.length > 0 &&
			!(
				exemption &&
				isRateLimitExempt(key.rateLimitMode, exemption(key.provider))
			)
			? [{ id: key.id, windows }]
			: [];
	});
	if (capped.length === 0) {
		return new Map();
	}
	const results = await Promise.all(
		capped.map(async ({ id, windows }) => ({
			id,
			retryAfter: await getRetryAfter(windows),
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

/**
 * The given provider keys that are at one of their own RPM/RPD/TPM/TPD caps,
 * mapped to the seconds until each is usable again. With `model` (a canonical
 * model id) a key's caps for that model count too; without it only key-wide
 * caps do. A soft or lax key the request is exempt from never counts as
 * capped. Only keys with a cap configured touch Redis.
 */
export async function getRateLimitedProviderKeys(
	keys: readonly ProviderKeyRateLimits[],
	exemption?: ProviderKeyRateLimitExemption,
	model?: string,
): Promise<Map<string, number>> {
	return await getLimitedKeys(
		keys,
		(key) => configuredWindows(key, model),
		exemption,
	);
}

export async function getRateLimitedProviderKeyIds(
	keys: readonly ProviderKeyRateLimits[],
	exemption?: ProviderKeyRateLimitExemption,
	model?: string,
): Promise<Set<string>> {
	return new Set(
		(await getRateLimitedProviderKeys(keys, exemption, model)).keys(),
	);
}

/**
 * Extends ids already found capped on their key-wide caps (from a model-less
 * {@link getRateLimitedProviderKeyIds}, read once for several models) with the
 * keys capped on their own caps for `model`. Reads only the model windows.
 */
export async function withModelRateLimitedProviderKeyIds(
	keyWideLimited: ReadonlySet<string>,
	keys: readonly ProviderKeyRateLimits[],
	model: string,
	exemption?: ProviderKeyRateLimitExemption,
): Promise<ReadonlySet<string>> {
	const modelLimited = await getLimitedKeys(
		keys.filter((key) => !keyWideLimited.has(key.id)),
		(key) => modelWindows(key, model),
		exemption,
	);
	return modelLimited.size === 0
		? keyWideLimited
		: new Set([...keyWideLimited, ...modelLimited.keys()]);
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

/**
 * The given keys minus those currently at one of their own caps, including
 * their caps for `model` when given.
 */
export async function excludeRateLimitedProviderKeys<
	T extends ProviderKeyRateLimits,
>(
	keys: T[],
	exemption?: ProviderKeyRateLimitExemption,
	model?: string,
): Promise<T[]> {
	const limited = await getRateLimitedProviderKeyIds(keys, exemption, model);
	return limited.size === 0 ? keys : keys.filter((key) => !limited.has(key.id));
}

/**
 * Count one served request and its prompt + completion tokens against a
 * provider key's caps, and against its caps for `model` (the canonical model
 * id served). Recorded when the request is logged, so the caps are post-paid:
 * in-flight requests are not yet counted. Swallows its own errors so logging
 * is never blocked.
 */
export async function recordProviderKeyUsage(
	key: ProviderKeyRateLimits,
	tokens: number,
	model?: string,
): Promise<void> {
	const windows = configuredWindows(key, model);
	if (windows.length === 0) {
		return;
	}
	try {
		const now = Date.now();
		const member = `${now}:${randomUUID()}`;
		await Promise.all(
			windows.map(async ({ window, redisKey }) => {
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
