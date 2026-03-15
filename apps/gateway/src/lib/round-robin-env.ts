/**
 * Round-robin environment variable utility
 * Supports comma-separated values in environment variables with round-robin load balancing
 * Now includes uptime-aware routing with weighted scoring based on historical error rates
 */

import {
	isKeyHealthy,
	getKeyMetrics,
	calculateUptimePenalty,
	type KeyMetrics,
} from "./api-key-health.js";

/**
 * Stores the current index for each environment variable
 */
const roundRobinCounters = new Map<string, number>();

/**
 * Parse a comma-separated environment variable into an array of values
 * @param value The environment variable value (potentially comma-separated)
 * @returns Array of trimmed values
 */
export function parseCommaSeparatedEnv(value: string): string[] {
	return value
		.split(",")
		.map((v) => v.trim())
		.filter((v) => v.length > 0);
}

export interface RoundRobinResult {
	value: string;
	index: number;
}

interface KeyScore {
	index: number;
	score: number;
	metrics: KeyMetrics;
}

/**
 * Get the next value from a comma-separated environment variable using uptime-weighted selection
 * Keys with better uptime scores are preferred, but round-robin is still used among equally healthy keys
 * @param envVarName The name of the environment variable
 * @param value The environment variable value (potentially comma-separated)
 * @returns Object containing the selected value and its index
 */
export function getRoundRobinValue(
	envVarName: string,
	value: string,
): RoundRobinResult {
	const values = parseCommaSeparatedEnv(value);

	if (values.length === 0) {
		throw new Error(`Environment variable ${envVarName} is empty`);
	}

	if (values.length === 1) {
		return { value: values[0], index: 0 };
	}

	// Get current counter for this env var (default to 0)
	const startIndex = roundRobinCounters.get(envVarName) ?? 0;

	// Collect metrics and scores for all keys
	const keyScores: KeyScore[] = [];
	let hasAnyMetrics = false;

	for (let i = 0; i < values.length; i++) {
		const metrics = getKeyMetrics(envVarName, i);

		// Skip permanently blacklisted keys entirely
		if (metrics.permanentlyBlacklisted) {
			continue;
		}

		// Check if temporarily unhealthy (consecutive errors threshold)
		if (!isKeyHealthy(envVarName, i)) {
			continue;
		}

		// Track if we have any historical data
		if (metrics.totalRequests > 0) {
			hasAnyMetrics = true;
		}

		// Calculate score based on uptime penalty (lower is better)
		const uptimePenalty = calculateUptimePenalty(metrics.uptime);

		keyScores.push({
			index: i,
			score: uptimePenalty,
			metrics,
		});
	}

	// If all keys are unhealthy, fall back to round-robin
	if (keyScores.length === 0) {
		const currentIndex = startIndex % values.length;
		const selectedValue = values[currentIndex];
		const nextIndex = (currentIndex + 1) % values.length;
		roundRobinCounters.set(envVarName, nextIndex);
		return { value: selectedValue, index: currentIndex };
	}

	// If no metrics available, use round-robin among healthy keys
	if (!hasAnyMetrics) {
		// Find the first healthy key starting from startIndex
		for (let i = 0; i < keyScores.length; i++) {
			const candidateIndex = (startIndex + i) % values.length;
			const keyScore = keyScores.find((k) => k.index === candidateIndex);
			if (keyScore) {
				const nextIndex = (candidateIndex + 1) % values.length;
				roundRobinCounters.set(envVarName, nextIndex);
				return { value: values[candidateIndex], index: candidateIndex };
			}
		}
		// Fallback: use first healthy key
		const firstHealthy = keyScores[0];
		const nextIndex = (firstHealthy.index + 1) % values.length;
		roundRobinCounters.set(envVarName, nextIndex);
		return { value: values[firstHealthy.index], index: firstHealthy.index };
	}

	// Find the best score (lowest penalty)
	const bestScore = Math.min(...keyScores.map((k) => k.score));

	// Get all keys with the best score (or very close to it)
	// Using a small epsilon to group keys with similar scores
	const SCORE_EPSILON = 0.01;
	const bestKeys = keyScores.filter(
		(k) => k.score <= bestScore + SCORE_EPSILON,
	);

	// Among the best keys, use round-robin to distribute load
	// Sort by index and find the next one after startIndex
	bestKeys.sort((a, b) => a.index - b.index);

	let selectedKey: KeyScore | undefined;
	for (const key of bestKeys) {
		if (key.index >= startIndex) {
			selectedKey = key;
			break;
		}
	}
	// Wrap around if needed
	selectedKey ??= bestKeys[0];

	const nextIndex = (selectedKey.index + 1) % values.length;
	roundRobinCounters.set(envVarName, nextIndex);

	return { value: values[selectedKey.index], index: selectedKey.index };
}

/**
 * Get the nth value from a comma-separated environment variable
 * This is used for related environment variables (e.g., regions) that should match the API key index
 * @param value The environment variable value (potentially comma-separated)
 * @param index The index to retrieve (0-based)
 * @param defaultValue Optional default value if index is out of bounds
 * @returns The value at the specified index, or the last value if index is out of bounds, or defaultValue if provided
 */
export function getNthValue(
	value: string,
	index: number,
	defaultValue?: string,
): string {
	const values = parseCommaSeparatedEnv(value);

	if (values.length === 0) {
		if (defaultValue !== undefined) {
			return defaultValue;
		}
		throw new Error("Environment variable is empty");
	}

	// If index is out of bounds, use the last value (or first if single value)
	// This allows having fewer region/project entries than API keys
	if (index >= values.length) {
		return values[values.length - 1];
	}

	return values[index];
}

/**
 * Reset all round-robin counters (useful for testing)
 */
export function resetRoundRobinCounters(): void {
	roundRobinCounters.clear();
}
