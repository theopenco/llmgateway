/**
 * Environment variable key selection utility
 * Supports comma-separated values in environment variables with primary-first
 * selection and health-aware failover.
 */

import {
	isKeyHealthy,
	getKeyMetrics,
	calculateUptimePenalty,
	type KeyMetrics,
} from "./api-key-health.js";

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

function selectRoundRobinValue(
	envVarName: string,
	value: string,
	_advanceCounter: boolean,
	excludedIndices: ReadonlySet<number> = new Set(),
): RoundRobinResult {
	const values = parseCommaSeparatedEnv(value);
	const availableValues = values.filter(
		(_, index) => !excludedIndices.has(index),
	);

	if (values.length === 0) {
		throw new Error(`Environment variable ${envVarName} is empty`);
	}

	if (availableValues.length === 0) {
		throw new Error(`No eligible values remain for ${envVarName}`);
	}

	if (availableValues.length === 1) {
		const selectedIndex = values.findIndex(
			(candidate, index) =>
				!excludedIndices.has(index) && candidate === availableValues[0],
		);
		return { value: availableValues[0], index: selectedIndex };
	}

	// Collect metrics and scores for all healthy keys.
	const keyScores: KeyScore[] = [];

	for (let i = 0; i < values.length; i++) {
		if (excludedIndices.has(i)) {
			continue;
		}

		const metrics = getKeyMetrics(envVarName, i);

		// Skip permanently blacklisted keys entirely
		if (metrics.permanentlyBlacklisted) {
			continue;
		}

		// Check if temporarily unhealthy (consecutive errors threshold)
		if (!isKeyHealthy(envVarName, i)) {
			continue;
		}

		const uptimePenalty = calculateUptimePenalty(metrics.uptime);

		keyScores.push({
			index: i,
			score: uptimePenalty,
			metrics,
		});
	}

	// If all remaining keys are unhealthy, fall back to the first non-excluded key.
	if (keyScores.length === 0) {
		const fallbackIndex = values.findIndex(
			(_, index) => !excludedIndices.has(index),
		);
		return { value: values[fallbackIndex], index: fallbackIndex };
	}

	// Keep the first key as the default as long as its uptime isn't materially
	// worse than the best healthy alternative.
	const primaryKey = keyScores.find((key) => key.index === 0);
	const bestScore = Math.min(...keyScores.map((k) => k.score));
	const SCORE_EPSILON = 0.01;
	if (primaryKey && primaryKey.score <= bestScore + SCORE_EPSILON) {
		return { value: values[primaryKey.index], index: primaryKey.index };
	}

	const selectedKey = [...keyScores]
		.sort((a, b) => a.score - b.score || a.index - b.index)
		.find((key) => key.score <= bestScore + SCORE_EPSILON);

	if (!selectedKey) {
		return { value: values[0], index: 0 };
	}

	return { value: values[selectedKey.index], index: selectedKey.index };
}

/**
 * Get the preferred value from a comma-separated environment variable using
 * primary-first selection with health-aware failover.
 * @param envVarName The name of the environment variable
 * @param value The environment variable value (potentially comma-separated)
 * @returns Object containing the selected value and its index
 */
export function getRoundRobinValue(
	envVarName: string,
	value: string,
	excludedIndices?: ReadonlySet<number>,
): RoundRobinResult {
	return selectRoundRobinValue(envVarName, value, true, excludedIndices);
}

/**
 * Get the current value from a comma-separated environment variable without
 * mutating any selector state. Kept for call-site compatibility.
 */
export function peekRoundRobinValue(
	envVarName: string,
	value: string,
	excludedIndices?: ReadonlySet<number>,
): RoundRobinResult {
	return selectRoundRobinValue(envVarName, value, false, excludedIndices);
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
 * Reset selector state (kept for test compatibility)
 */
export function resetRoundRobinCounters(): void {}
