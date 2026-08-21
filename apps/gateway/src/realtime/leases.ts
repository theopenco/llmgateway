import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { RealtimeConnectError } from "./errors.js";

const LEASE_TTL_MS = 90_000;
export const LEASE_HEARTBEAT_INTERVAL_MS = 30_000;

const maxSessionsPerOrg = () =>
	Number(process.env.REALTIME_MAX_SESSIONS_PER_ORG) || 20;
const maxSessionsPerKey = () =>
	Number(process.env.REALTIME_MAX_SESSIONS_PER_KEY) || 10;

function orgKey(organizationId: string): string {
	return `realtime:leases:org:${organizationId}`;
}

function apiKeyKey(apiKeyId: string): string {
	return `realtime:leases:key:${apiKeyId}`;
}

// Atomic check-and-acquire: drop stale leases (crashed pods), enforce both
// caps, then add the session to both sets — all in one script so concurrent
// handshakes cannot both observe capacity and exceed a limit, and a partial
// acquisition (org added, key not) is impossible.
const ACQUIRE_LEASE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
	return 'org'
end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then
	return 'key'
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[5])
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[5])
return 'ok'
`;

export interface RealtimeLease {
	sessionId: string;
	organizationId: string;
	apiKeyId: string;
}

/**
 * Acquire per-organization and per-API-key concurrency slots for a session.
 * Leases are Redis sorted-set members scored by expiry and renewed by
 * heartbeat, so stale entries from crashed processes age out on their own.
 * Fails closed: if Redis is unavailable the connection is rejected.
 */
export async function acquireRealtimeLease(
	lease: RealtimeLease,
): Promise<void> {
	const now = Date.now();
	let result: unknown;
	try {
		result = await redisClient.eval(
			ACQUIRE_LEASE_SCRIPT,
			2,
			orgKey(lease.organizationId),
			apiKeyKey(lease.apiKeyId),
			now,
			now + LEASE_TTL_MS,
			maxSessionsPerOrg(),
			maxSessionsPerKey(),
			lease.sessionId,
		);
	} catch (error) {
		logger.error(
			"Realtime lease check failed, rejecting connection",
			error as Error,
		);
		throw new RealtimeConnectError(
			503,
			"lease_unavailable",
			"Realtime session limits are temporarily unavailable. Please retry.",
		);
	}

	if (result === "org") {
		throw new RealtimeConnectError(
			429,
			"org_session_limit",
			`Organization has reached its concurrent realtime session limit (${maxSessionsPerOrg()}).`,
		);
	}
	if (result === "key") {
		throw new RealtimeConnectError(
			429,
			"key_session_limit",
			`API key has reached its concurrent realtime session limit (${maxSessionsPerKey()}).`,
		);
	}
}

export async function renewRealtimeLease(lease: RealtimeLease): Promise<void> {
	const expiry = Date.now() + LEASE_TTL_MS;
	try {
		await redisClient.zadd(
			orgKey(lease.organizationId),
			expiry,
			lease.sessionId,
		);
		await redisClient.zadd(apiKeyKey(lease.apiKeyId), expiry, lease.sessionId);
	} catch (error) {
		// A missed heartbeat is tolerable — the lease simply ages out early.
		logger.error("Realtime lease renewal failed", error as Error);
	}
}

export async function releaseRealtimeLease(
	lease: RealtimeLease,
): Promise<void> {
	try {
		await redisClient.zrem(orgKey(lease.organizationId), lease.sessionId);
		await redisClient.zrem(apiKeyKey(lease.apiKeyId), lease.sessionId);
	} catch (error) {
		// Aging out via the TTL is the fallback if the release write fails.
		logger.error("Realtime lease release failed", error as Error);
	}
}
