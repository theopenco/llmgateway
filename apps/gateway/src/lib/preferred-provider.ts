import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_UPTIME_THRESHOLD = 85;
const DEFAULT_SCORE_MARGIN = 0.15;

function getTtl(): number {
	const raw = process.env.PREFERRED_PROVIDER_TTL;
	if (!raw) {
		return DEFAULT_TTL_SECONDS;
	}
	const v = parseInt(raw, 10);
	return Number.isFinite(v) && v > 0 ? v : DEFAULT_TTL_SECONDS;
}

function getUptimeThreshold(): number {
	const raw = process.env.PREFERRED_PROVIDER_UPTIME_THRESHOLD;
	if (!raw) {
		return DEFAULT_UPTIME_THRESHOLD;
	}
	const v = parseFloat(raw);
	return Number.isFinite(v) && v >= 0 && v <= 100
		? v
		: DEFAULT_UPTIME_THRESHOLD;
}

function getScoreMargin(): number {
	const raw = process.env.PREFERRED_PROVIDER_SCORE_MARGIN;
	if (!raw) {
		return DEFAULT_SCORE_MARGIN;
	}
	const v = parseFloat(raw);
	return Number.isFinite(v) && v >= 0 ? v : DEFAULT_SCORE_MARGIN;
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
): Promise<void> {
	try {
		await redisClient.set(
			redisKey(orgId, modelId),
			JSON.stringify({ providerId, region }),
			"EX",
			getTtl(),
		);
	} catch (error) {
		logger.error("Error setting preferred provider in Redis:", error as Error);
	}
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
		preferredScore.uptime < getUptimeThreshold()
	) {
		return null;
	}

	// Soft switch: only move away when a meaningfully better provider exists
	const bestScore = Math.min(...providerScores.map((s) => s.score));
	if (preferredScore.score - bestScore > getScoreMargin()) {
		return null;
	}

	return preferredCandidate;
}
