import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";
import {
	DEFAULT_ROUTING_STICKY,
	type RoutingStickyConfig,
} from "@llmgateway/shared/routing-config";

import type { SessionProviderStore } from "@llmgateway/actions";

type StickyCfg = Required<RoutingStickyConfig>;

function getTtl(cfg?: StickyCfg): number {
	if (cfg) {
		return cfg.ttlSeconds;
	}
	const raw = process.env.PREFERRED_PROVIDER_TTL;
	if (!raw) {
		return DEFAULT_ROUTING_STICKY.ttlSeconds;
	}
	const v = parseInt(raw, 10);
	return Number.isFinite(v) && v > 0 ? v : DEFAULT_ROUTING_STICKY.ttlSeconds;
}

function getUptimeThreshold(cfg?: StickyCfg): number {
	if (cfg) {
		return cfg.uptimeThreshold;
	}
	const raw = process.env.PREFERRED_PROVIDER_UPTIME_THRESHOLD;
	if (!raw) {
		return DEFAULT_ROUTING_STICKY.uptimeThreshold;
	}
	const v = parseFloat(raw);
	return Number.isFinite(v) && v >= 0 && v <= 100
		? v
		: DEFAULT_ROUTING_STICKY.uptimeThreshold;
}

function getScoreMargin(cfg?: StickyCfg): number {
	if (cfg) {
		return cfg.scoreMargin;
	}
	const raw = process.env.PREFERRED_PROVIDER_SCORE_MARGIN;
	if (!raw) {
		return DEFAULT_ROUTING_STICKY.scoreMargin;
	}
	const v = parseFloat(raw);
	return Number.isFinite(v) && v >= 0 ? v : DEFAULT_ROUTING_STICKY.scoreMargin;
}

function redisKey(orgId: string, modelId: string): string {
	return `preferred_provider:${orgId}:${modelId}`;
}

export interface PreferredProviderEntry {
	providerId: string;
	region?: string;
}

export async function getPreferredProvider(
	orgId: string,
	modelId: string,
): Promise<PreferredProviderEntry | null> {
	try {
		const value = await redisClient.get(redisKey(orgId, modelId));
		if (!value) {
			return null;
		}
		return JSON.parse(value) as PreferredProviderEntry;
	} catch (error) {
		logger.error(
			"Error getting preferred provider from Redis:",
			error as Error,
		);
		return null;
	}
}

export async function setPreferredProvider(
	orgId: string,
	modelId: string,
	providerId: string,
	region?: string,
	cfg?: StickyCfg,
): Promise<void> {
	try {
		await redisClient.set(
			redisKey(orgId, modelId),
			JSON.stringify({ providerId, region }),
			"EX",
			getTtl(cfg),
		);
	} catch (error) {
		logger.error("Error setting preferred provider in Redis:", error as Error);
	}
}

function sessionRedisKey(
	orgId: string,
	modelId: string,
	sessionId: string,
): string {
	return `session_provider:${orgId}:${modelId}:${sessionId}`;
}

async function getSessionProvider(
	orgId: string,
	modelId: string,
	sessionId: string,
): Promise<PreferredProviderEntry | null> {
	try {
		const value = await redisClient.get(
			sessionRedisKey(orgId, modelId, sessionId),
		);
		if (!value) {
			return null;
		}
		return JSON.parse(value) as PreferredProviderEntry;
	} catch (error) {
		logger.error("Error getting session provider from Redis:", error as Error);
		return null;
	}
}

async function setSessionProvider(
	orgId: string,
	modelId: string,
	sessionId: string,
	providerId: string,
	region: string | undefined,
	ttlSeconds: number,
): Promise<void> {
	try {
		await redisClient.set(
			sessionRedisKey(orgId, modelId, sessionId),
			JSON.stringify({ providerId, region }),
			"EX",
			ttlSeconds,
		);
	} catch (error) {
		logger.error("Error setting session provider in Redis:", error as Error);
	}
}

/**
 * Build a session-scoped provider store for sticky routing. The selection logic
 * in @llmgateway/actions reads/writes the pinned provider through this so the
 * same session reuses its provider across requests (keeping upstream prompt
 * caches warm), re-scoring only when the pin is no longer viable.
 */
export function createSessionProviderStore(
	orgId: string,
	modelId: string,
	sessionId: string,
	ttlSeconds: number,
): SessionProviderStore {
	return {
		get: () => getSessionProvider(orgId, modelId, sessionId),
		set: (providerId, region) =>
			setSessionProvider(
				orgId,
				modelId,
				sessionId,
				providerId,
				region,
				ttlSeconds,
			),
	};
}

export interface ProviderScoreForHysteresis {
	providerId: string;
	region?: string;
	score: number;
	uptime?: number;
}

/**
 * Returns the candidate matching the stored preferred provider if it is still
 * acceptable to route to (uptime above threshold, score within margin of best).
 * Returns null when the preferred provider should be replaced with the current best.
 */
export function resolvePreferredProvider<
	T extends { providerId: string; region?: string },
>(
	preferred: PreferredProviderEntry,
	candidates: T[],
	providerScores: ProviderScoreForHysteresis[],
	cfg?: StickyCfg,
): T | null {
	const preferredCandidate = candidates.find(
		(c) =>
			c.providerId === preferred.providerId &&
			(preferred.region === undefined || c.region === preferred.region),
	);
	if (!preferredCandidate) {
		return null;
	}

	const preferredScore = providerScores.find(
		(s) =>
			s.providerId === preferred.providerId &&
			(preferred.region === undefined || s.region === preferred.region),
	);
	if (!preferredScore) {
		return null;
	}

	// Hard switch when uptime drops below threshold regardless of score
	if (
		preferredScore.uptime !== undefined &&
		preferredScore.uptime < getUptimeThreshold(cfg)
	) {
		return null;
	}

	// Soft switch: only move away when a meaningfully better provider exists
	const bestScore = Math.min(...providerScores.map((s) => s.score));
	if (preferredScore.score - bestScore > getScoreMargin(cfg)) {
		return null;
	}

	return preferredCandidate;
}
