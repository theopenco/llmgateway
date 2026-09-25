import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import type { AutoRoutingClassification } from "@llmgateway/shared/auto-routing";

export interface AutoRoutingSessionEntry {
	classification: AutoRoutingClassification;
	/** The model the first classified request in this session resolved to. */
	selectedModel: string;
}

/** A dynamic route branches on the verdict and picks the model itself. */
export interface ClassifierSessionEntry {
	classification: AutoRoutingClassification;
}

export interface AutoRoutingSessionStore {
	get: () => Promise<AutoRoutingSessionEntry | null>;
	/**
	 * Claim the session for `entry`, returning whichever entry won. Concurrent
	 * opening turns both classify, so without an atomic claim the later write
	 * would replace the pin the earlier request is already being served under.
	 */
	claim: (entry: AutoRoutingSessionEntry) => Promise<AutoRoutingSessionEntry>;
	/** Refresh an existing pin's TTL. */
	refresh: (entry: AutoRoutingSessionEntry) => Promise<void>;
}

/**
 * Keyed on the project, not the model: the model is what the pin decides. A
 * session id is client-supplied, so scoping to the project keeps one project's
 * pin from being read under another project's auto-routing configuration.
 */
function sessionRedisKey(
	orgId: string,
	projectId: string,
	sessionId: string,
): string {
	return `session_auto_routing:${orgId}:${projectId}:${sessionId}`;
}

/**
 * Session-scoped store for an auto-routing classification, so a sticky session
 * classifies once and reuses that verdict for its remaining turns instead of
 * paying for (and re-deciding with) a classifier call per request.
 *
 * Shares the sticky-session TTL with provider pinning, and like it re-persists
 * on every hit so an active session keeps its pin alive.
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

export function createAutoRoutingSessionStore(
	orgId: string,
	projectId: string,
	sessionId: string,
	ttlSeconds: number,
): AutoRoutingSessionStore {
	return createStore<AutoRoutingSessionEntry>(
		sessionRedisKey(orgId, projectId, sessionId),
		ttlSeconds,
	);
}
