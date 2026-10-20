import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { HTTPException } from "hono/http-exception";

import { redisClient } from "@/auth/config.js";

import { logger } from "@llmgateway/logger";

/**
 * Response cache for unauthenticated endpoints backed by heavy aggregations.
 *
 * Every response is served from cache. A stale entry is still served while one
 * request across all API pods recomputes it in the background (a Redis lock
 * elects it), so Postgres sees at most one query set per key per
 * `refreshAfterMs`, however much traffic arrives. Only a cold key makes callers
 * wait, and even then a single caller computes while the rest poll for its
 * result. Failed computations are never cached.
 */

export interface PublicResponseCacheOptions {
	/** Minimum time between recomputations of one key. */
	refreshAfterMs: number;
	/** How long an entry stays servable without a successful refresh. */
	maxStaleMs?: number;
}

interface Entry<T> {
	data: T;
	computedAt: number;
}

const KEY_PREFIX = "public-response:v1:";
const LOCK_PREFIX = "public-response:lock:v1:";
// Longer than any computation may run (the database caps statements at 60s).
const LOCK_MS = 90_000;
// After a failed computation, the lock is kept this long so a failing query is
// not retried on every request.
const FAILURE_BACKOFF_MS = 15_000;
const COLD_WAIT_MS = 30_000;
const POLL_MS = 250;
const DEFAULT_MAX_STALE_MS = 24 * 60 * 60 * 1000;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
	return redis.call('DEL', KEYS[1])
end
return 0
`;

// Per-process copy, so a Redis outage degrades to one computation per key per
// pod per interval rather than one per request.
const localEntries = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<Entry<unknown> | undefined>>();

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

async function readShared<T>(key: string): Promise<Entry<T> | undefined> {
	try {
		const raw = await redisClient.get(KEY_PREFIX + key);
		return raw ? (JSON.parse(raw) as Entry<T>) : undefined;
	} catch (error) {
		logger.error("Public response cache read failed", toError(error), { key });
		return undefined;
	}
}

async function readEntry<T>(key: string): Promise<Entry<T> | undefined> {
	const local = localEntries.get(key) as Entry<T> | undefined;
	const shared = await readShared<T>(key);
	if (!shared) {
		return local;
	}
	if (!local || shared.computedAt > local.computedAt) {
		localEntries.set(key, shared);
		return shared;
	}
	return local;
}

/** Returns a lock token, null when another caller holds the lock. */
async function acquireLock(key: string): Promise<string | null> {
	const token = randomUUID();
	try {
		const result = await redisClient.set(
			LOCK_PREFIX + key,
			token,
			"PX",
			LOCK_MS,
			"NX",
		);
		return result === "OK" ? token : null;
	} catch (error) {
		// Without Redis there is no cross-pod election; the in-process
		// single-flight still bounds this pod to one computation at a time.
		logger.error("Public response cache lock failed", toError(error), { key });
		return token;
	}
}

async function settleLock(
	key: string,
	token: string,
	succeeded: boolean,
): Promise<void> {
	try {
		if (succeeded) {
			await redisClient.eval(RELEASE_SCRIPT, 1, LOCK_PREFIX + key, token);
		} else {
			await redisClient.pexpire(LOCK_PREFIX + key, FAILURE_BACKOFF_MS);
		}
	} catch (error) {
		// The lock expires on its own after LOCK_MS.
		logger.error("Public response cache unlock failed", toError(error), {
			key,
		});
	}
}

/**
 * Recomputes `key` if this caller wins the lock. Resolves to the new entry, or
 * undefined when another caller is already computing it.
 */
function refresh<T>(
	key: string,
	options: PublicResponseCacheOptions,
	compute: () => Promise<T>,
): Promise<Entry<T> | undefined> {
	const existing = inFlight.get(key) as Promise<Entry<T> | undefined>;
	if (existing) {
		return existing;
	}
	const run = (async () => {
		const token = await acquireLock(key);
		if (!token) {
			return undefined;
		}
		let succeeded = false;
		try {
			const entry: Entry<T> = { data: await compute(), computedAt: Date.now() };
			succeeded = true;
			localEntries.set(key, entry);
			try {
				await redisClient.set(
					KEY_PREFIX + key,
					JSON.stringify(entry),
					"PX",
					options.maxStaleMs ?? DEFAULT_MAX_STALE_MS,
				);
			} catch (error) {
				logger.error("Public response cache write failed", toError(error), {
					key,
				});
			}
			return entry;
		} finally {
			await settleLock(key, token, succeeded);
		}
	})();
	inFlight.set(key, run);
	void run.then(
		() => inFlight.delete(key),
		() => inFlight.delete(key),
	);
	return run;
}

export async function cachedPublicResponse<T>(
	key: string,
	options: PublicResponseCacheOptions,
	compute: () => Promise<T>,
): Promise<T> {
	const maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
	const entry = await readEntry<T>(key);
	if (entry) {
		const age = Date.now() - entry.computedAt;
		if (age < maxStaleMs) {
			if (age >= options.refreshAfterMs) {
				refresh(key, options, compute).catch((error: unknown) => {
					logger.error("Public response cache refresh failed", toError(error), {
						key,
					});
				});
			}
			return entry.data;
		}
	}

	// Cold: one caller computes, everyone else waits for its result.
	const deadline = Date.now() + COLD_WAIT_MS;
	for (;;) {
		const fresh = await refresh(key, options, compute);
		if (fresh) {
			return fresh.data;
		}
		await sleep(POLL_MS);
		const shared = await readEntry<T>(key);
		if (shared && Date.now() - shared.computedAt < maxStaleMs) {
			return shared.data;
		}
		if (Date.now() >= deadline) {
			throw new HTTPException(503, {
				message: "Temporarily unavailable. Try again shortly.",
			});
		}
	}
}

/** Drops a cached response so the next request recomputes it. */
export async function invalidatePublicResponse(key: string): Promise<void> {
	localEntries.delete(key);
	try {
		await redisClient.del(KEY_PREFIX + key);
	} catch (error) {
		logger.error("Public response cache invalidation failed", toError(error), {
			key,
		});
	}
}

/** Test helper: forget the per-process copies. */
export function resetLocalPublicResponseCache(): void {
	localEntries.clear();
}
