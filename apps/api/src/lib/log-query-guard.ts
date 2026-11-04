import { randomUUID } from "node:crypto";

import { HTTPException } from "hono/http-exception";

import { redisClient } from "@/auth/config.js";

import { db, sql } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

/**
 * Guards for customer-facing reads of the `log` table, which holds billions of
 * rows. A slow log query holds ACCESS SHARE locks on every table it reads for
 * as long as it runs, and one queued schema change behind those locks blocks
 * every other query on the table (the 2026-10-19 outage). Each search is
 * therefore capped in runtime, fails fast when it would wait on a lock, and is
 * limited in concurrency per user and per organization.
 */

function envInt(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function logQueryTimeoutMs(): number {
	return envInt("LOG_QUERY_TIMEOUT_MS", 10_000);
}

function logQueryLockTimeoutMs(): number {
	return envInt("LOG_QUERY_LOCK_TIMEOUT_MS", 2000);
}

const QUERY_CANCELED = "57014";
const LOCK_NOT_AVAILABLE = "55P03";

function pgErrorCode(error: unknown): string | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current; depth++) {
		if (typeof current !== "object") {
			return undefined;
		}
		const { code, cause } = current as { code?: unknown; cause?: unknown };
		if (typeof code === "string") {
			return code;
		}
		current = cause;
	}
	return undefined;
}

type LogQueryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `run` in a read-only transaction with a statement timeout and a short
 * lock timeout. Postgres cancels the query when either is hit, which releases
 * its locks; the caller gets a 504 asking for narrower filters.
 */
export async function withLogQueryLimits<T>(
	run: (tx: LogQueryTx) => Promise<T>,
): Promise<T> {
	const timeoutMs = logQueryTimeoutMs();
	try {
		return await db.transaction(
			async (tx) => {
				await tx.execute(
					sql`select set_config('statement_timeout', ${String(timeoutMs)}, true), set_config('lock_timeout', ${String(logQueryLockTimeoutMs())}, true)`,
				);
				return await run(tx);
			},
			{ accessMode: "read only" },
		);
	} catch (error) {
		const code = pgErrorCode(error);
		if (code === QUERY_CANCELED || code === LOCK_NOT_AVAILABLE) {
			logger.warn("Log query canceled", {
				reason: code === QUERY_CANCELED ? "statement_timeout" : "lock_timeout",
				timeoutMs,
			});
			throw new HTTPException(504, {
				message:
					code === QUERY_CANCELED
						? `Log search took longer than ${Math.round(timeoutMs / 1000)}s and was canceled. Narrow the date range or remove filters.`
						: "Log search was canceled because the logs are briefly locked for maintenance. Try again in a moment.",
			});
		}
		throw error;
	}
}

// Sliding-window semaphore over sorted sets: entries older than the TTL are
// dropped, so a slot leaked by a crashed request frees itself.
const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local token = ARGV[3]
for i, key in ipairs(KEYS) do
	redis.call('ZREMRANGEBYSCORE', key, '-inf', now - ttl)
	if redis.call('ZCARD', key) >= tonumber(ARGV[3 + i]) then
		return i
	end
end
for _, key in ipairs(KEYS) do
	redis.call('ZADD', key, now, token)
	redis.call('PEXPIRE', key, ttl)
end
return 0
`;

const SLOT_PREFIX = "log-query-slots:";

export interface LogQuerySlotScope {
	userId: string;
	organizationIds: string[];
}

/**
 * Takes one concurrent log-search slot for the user and for each organization
 * the search spans; throws 429 when any of them is full. Returns the release
 * function. Fails open (logged) when Redis is unavailable, so a cache outage
 * does not take the logs page down with it.
 */
export async function acquireLogQuerySlot(
	scope: LogQuerySlotScope,
): Promise<() => Promise<void>> {
	const perUser = envInt("LOG_QUERY_MAX_CONCURRENT_PER_USER", 3);
	const perOrg = envInt("LOG_QUERY_MAX_CONCURRENT_PER_ORG", 6);
	const organizationIds = [...new Set(scope.organizationIds)].sort();
	const keys = [
		`${SLOT_PREFIX}user:${scope.userId}`,
		...organizationIds.map((id) => `${SLOT_PREFIX}org:${id}`),
	];
	const limits = [perUser, ...organizationIds.map(() => perOrg)];
	// A slot outlives the longest query it can guard, plus slack.
	const ttlMs = logQueryTimeoutMs() + 20_000;
	const token = randomUUID();

	let blocked: number;
	try {
		blocked = Number(
			await redisClient.eval(
				ACQUIRE_SCRIPT,
				keys.length,
				...keys,
				Date.now(),
				ttlMs,
				token,
				...limits,
			),
		);
	} catch (error) {
		logger.error(
			"Log query concurrency limiter unavailable; running unlimited",
			error instanceof Error ? error : new Error(String(error)),
		);
		return async () => {};
	}

	if (blocked > 0) {
		throw new HTTPException(429, {
			message:
				blocked === 1
					? "Too many log searches in progress for your account. Wait for them to finish and try again."
					: "Too many log searches in progress for this organization. Wait for them to finish and try again.",
		});
	}

	return async () => {
		try {
			const pipeline = redisClient.pipeline();
			for (const key of keys) {
				pipeline.zrem(key, token);
			}
			await pipeline.exec();
		} catch (error) {
			// The slot expires on its own after ttlMs.
			logger.error(
				"Failed to release log query slot",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	};
}
