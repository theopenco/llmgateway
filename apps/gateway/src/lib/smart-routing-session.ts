import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import type {
	RequestClassification,
	SmartRoutingEffort,
} from "@llmgateway/shared/smart-routing";

export interface SmartRoutingSessionEntry {
	/** Bumped on every write; absent on entries written before rechecks. */
	version?: number;
	/** The verdict the current choice was made for: the work snapshot. */
	classification: RequestClassification;
	selectedModel: string;
	/** Absent when the caller sets the effort itself. */
	effort?: SmartRoutingEffort;
	/** User turns served, including the opening one. */
	turnCount?: number;
	turnsSinceCheck?: number;
	turnsSinceSwitch?: number;
	lastCheckAt?: number;
	lastSwitchAt?: number;
}

/**
 * What the session's served requests looked like, recorded after each
 * response. Kept apart from the entry so the response path only increments
 * counters instead of rewriting the choice.
 */
export interface SmartRoutingSessionActivity {
	lastActivityAt: number;
	/** Unified finish reason of the latest response. */
	lastFinishReason: string;
	lastProvider: string;
	lastPromptTokens: number;
	/** Whether any request of the session wrote the extended (1h) cache. */
	usedExtendedCache: boolean;
	requests: number;
	promptTokens: number;
	cachedTokens: number;
	outputTokens: number;
}

export interface SmartRoutingActivityRecord {
	finishReason: string;
	provider: string;
	promptTokens: number;
	cachedTokens: number;
	outputTokens: number;
	extendedCacheWrite: boolean;
}

/** A dynamic route branches on the verdict and picks the model itself. */
export interface ClassifierSessionEntry {
	classification: RequestClassification;
}

export interface SmartRoutingSessionStore {
	get: () => Promise<SmartRoutingSessionEntry | null>;
	getActivity: () => Promise<SmartRoutingSessionActivity | null>;
	/**
	 * Claim the session for `entry`, returning whichever entry won. Concurrent
	 * opening turns both classify, so without an atomic claim the later write
	 * would replace the pin the earlier request is already being served under.
	 */
	claim: (entry: SmartRoutingSessionEntry) => Promise<SmartRoutingSessionEntry>;
	/**
	 * Write `entry` only if the stored version is still `expectedVersion`,
	 * returning whichever entry is stored afterwards. A decision made against a
	 * stale read is discarded rather than overwriting a newer one.
	 */
	replace: (
		expectedVersion: number,
		entry: SmartRoutingSessionEntry,
	) => Promise<SmartRoutingSessionEntry>;
	/** Keep an active session's pin alive without rewriting it. */
	touch: () => Promise<void>;
	recordActivity: (record: SmartRoutingActivityRecord) => Promise<void>;
}

/**
 * Keyed on the project, not the model: the model is what the pin decides. A
 * session id is client-supplied, so scoping to the project keeps one project's
 * pin from being read under another project's smart-routing configuration.
 */
function sessionRedisKey(
	orgId: string,
	projectId: string,
	sessionId: string,
): string {
	return `session_auto_routing:${orgId}:${projectId}:${sessionId}`;
}

function activityRedisKey(
	orgId: string,
	projectId: string,
	sessionId: string,
): string {
	return `session_auto_routing_activity:${orgId}:${projectId}:${sessionId}`;
}

/** Returns nothing when it wrote, otherwise the entry that is stored. */
const REPLACE_IF_VERSION_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current then
	local ok, decoded = pcall(cjson.decode, current)
	local version = 0
	if ok and type(decoded) == 'table' and decoded.version then
		version = tonumber(decoded.version)
	end
	if version ~= tonumber(ARGV[2]) then
		return current
	end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return false
`;

function numberField(value: string | undefined): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Session-scoped store for a classifier verdict, so a sticky session reuses it
 * across turns instead of paying for (and re-deciding with) a classifier call
 * per request. Shares the sticky-session TTL with provider pinning, and keeps
 * an active session alive the same way.
 */
function createStore<T>(key: string, ttlSeconds: number) {
	return {
		get: async (): Promise<T | null> => {
			try {
				const value = await redisClient.get(key);
				return value ? (JSON.parse(value) as T) : null;
			} catch (error) {
				// Fail open to a fresh classification: a Redis outage must not stop
				// routing from resolving a model.
				logger.error(
					"Error getting session classifier entry from Redis:",
					error as Error,
				);
				return null;
			}
		},
		claim: async (entry: T): Promise<T> => {
			try {
				const won = await redisClient.set(
					key,
					JSON.stringify(entry),
					"EX",
					ttlSeconds,
					"NX",
				);
				if (won) {
					return entry;
				}
				const existing = await redisClient.get(key);
				return existing ? (JSON.parse(existing) as T) : entry;
			} catch (error) {
				// Fail open to this request's own verdict rather than failing the
				// request over a pin that is only an optimization.
				logger.error(
					"Error claiming session classifier entry in Redis:",
					error as Error,
				);
				return entry;
			}
		},
		refresh: async (entry: T): Promise<void> => {
			try {
				await redisClient.set(key, JSON.stringify(entry), "EX", ttlSeconds);
			} catch (error) {
				logger.error(
					"Error refreshing session classifier entry in Redis:",
					error as Error,
				);
			}
		},
	};
}

/**
 * Session-scoped store for a dynamic route's classifier verdict, so a sticky
 * session branches on one verdict for its whole conversation instead of
 * re-rating (and re-billing) every turn.
 */
export function createDynamicRouteClassifierStore(
	orgId: string,
	projectId: string,
	sessionId: string,
	ttlSeconds: number,
) {
	return createStore<ClassifierSessionEntry>(
		`session_route_classifier:${orgId}:${projectId}:${sessionId}`,
		ttlSeconds,
	);
}

export function createSmartRoutingSessionStore(
	orgId: string,
	projectId: string,
	sessionId: string,
	ttlSeconds: number,
): SmartRoutingSessionStore {
	const key = sessionRedisKey(orgId, projectId, sessionId);
	const activityKey = activityRedisKey(orgId, projectId, sessionId);
	const store = createStore<SmartRoutingSessionEntry>(key, ttlSeconds);

	return {
		get: store.get,
		claim: store.claim,
		getActivity: async () => {
			try {
				const fields = await redisClient.hgetall(activityKey);
				if (!fields || !fields.lastActivityAt) {
					return null;
				}
				return {
					lastActivityAt: numberField(fields.lastActivityAt),
					lastFinishReason: fields.lastFinishReason ?? "",
					lastProvider: fields.lastProvider ?? "",
					lastPromptTokens: numberField(fields.lastPromptTokens),
					usedExtendedCache: fields.usedExtendedCache === "1",
					requests: numberField(fields.requests),
					promptTokens: numberField(fields.promptTokens),
					cachedTokens: numberField(fields.cachedTokens),
					outputTokens: numberField(fields.outputTokens),
				};
			} catch (error) {
				logger.error(
					"Error getting smart routing session activity from Redis:",
					error as Error,
				);
				return null;
			}
		},
		replace: async (expectedVersion, entry) => {
			const next = { ...entry, version: expectedVersion + 1 };
			try {
				const stored = await redisClient.eval(
					REPLACE_IF_VERSION_SCRIPT,
					1,
					key,
					JSON.stringify(next),
					expectedVersion,
					ttlSeconds,
				);
				return typeof stored === "string"
					? (JSON.parse(stored) as SmartRoutingSessionEntry)
					: next;
			} catch (error) {
				// Serve this request under its own decision; the next turn reads
				// whatever is stored.
				logger.error(
					"Error replacing smart routing session entry in Redis:",
					error as Error,
				);
				return next;
			}
		},
		touch: async () => {
			try {
				await redisClient
					.pipeline()
					.expire(key, ttlSeconds)
					.expire(activityKey, ttlSeconds)
					.exec();
			} catch (error) {
				logger.error(
					"Error refreshing smart routing session TTL in Redis:",
					error as Error,
				);
			}
		},
		recordActivity: async (record) => {
			try {
				const pipeline = redisClient
					.pipeline()
					.hset(activityKey, {
						lastActivityAt: Date.now(),
						lastFinishReason: record.finishReason,
						lastProvider: record.provider,
						lastPromptTokens: record.promptTokens,
					})
					.hincrby(activityKey, "requests", 1)
					.hincrby(activityKey, "promptTokens", record.promptTokens)
					.hincrby(activityKey, "cachedTokens", record.cachedTokens)
					.hincrby(activityKey, "outputTokens", record.outputTokens);
				if (record.extendedCacheWrite) {
					pipeline.hset(activityKey, "usedExtendedCache", "1");
				}
				await pipeline.expire(activityKey, ttlSeconds).exec();
			} catch (error) {
				logger.error(
					"Error recording smart routing session activity in Redis:",
					error as Error,
				);
			}
		},
	};
}
