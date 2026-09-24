import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import type { AutoRoutingClassification } from "@llmgateway/shared/auto-routing";

export interface AutoRoutingSessionEntry {
	classification: AutoRoutingClassification;
	/** The model the first classified request in this session resolved to. */
	selectedModel: string;
}

export interface AutoRoutingSessionStore {
	get: () => Promise<AutoRoutingSessionEntry | null>;
	set: (entry: AutoRoutingSessionEntry) => Promise<void>;
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
export function createAutoRoutingSessionStore(
	orgId: string,
	projectId: string,
	sessionId: string,
	ttlSeconds: number,
): AutoRoutingSessionStore {
	const key = sessionRedisKey(orgId, projectId, sessionId);
	return {
		get: async () => {
			try {
				const value = await redisClient.get(key);
				if (!value) {
					return null;
				}
				return JSON.parse(value) as AutoRoutingSessionEntry;
			} catch (error) {
				// Fail open to a fresh classification: a Redis outage must not stop
				// auto routing from resolving a model.
				logger.error(
					"Error getting session auto-routing entry from Redis:",
					error as Error,
				);
				return null;
			}
		},
		set: async (entry) => {
			try {
				await redisClient.set(key, JSON.stringify(entry), "EX", ttlSeconds);
			} catch (error) {
				logger.error(
					"Error setting session auto-routing entry in Redis:",
					error as Error,
				);
			}
		},
	};
}
