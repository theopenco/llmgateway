/**
 * Round-robin environment variable utility
 * Supports comma-separated values in environment variables with round-robin load balancing
 * Now includes health-aware routing to skip unhealthy keys
 */

import { isKeyHealthy } from "./api-key-health.js";

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

/**
 * Get the next value from a comma-separated environment variable using round-robin
 * Now includes health-aware routing to skip unhealthy keys
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
	const startIndex = roundRobinCounters.get(envVarName) || 0;

	// Try to find a healthy key, starting from current index
	// Loop through all keys at most once
	for (let i = 0; i < values.length; i++) {
		const candidateIndex = (startIndex + i) % values.length;

		if (isKeyHealthy(envVarName, candidateIndex)) {
			// Found a healthy key - update counter to next position
			const nextIndex = (candidateIndex + 1) % values.length;
			roundRobinCounters.set(envVarName, nextIndex);

			return { value: values[candidateIndex], index: candidateIndex };
		}
	}

	// All keys are unhealthy - fall back to original round-robin behavior
	// This ensures we don't completely stop serving requests
	const currentIndex = startIndex;
	const selectedValue = values[currentIndex];
	const nextIndex = (currentIndex + 1) % values.length;
	roundRobinCounters.set(envVarName, nextIndex);

	return { value: selectedValue, index: currentIndex };
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
