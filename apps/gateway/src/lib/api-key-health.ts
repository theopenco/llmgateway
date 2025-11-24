/**
 * In-memory API key health tracking for uptime-aware routing
 * Tracks consecutive errors per API key and temporarily blacklists unhealthy keys
 */

export interface KeyHealth {
	consecutiveErrors: number;
	lastErrorTime: number;
	permanentlyBlacklisted: boolean;
}

/**
 * Stores health status for each API key
 * Key format: "envVarName:keyIndex"
 */
const keyHealthMap = new Map<string, KeyHealth>();

/**
 * Number of consecutive errors before a key is temporarily blacklisted
 */
const ERROR_THRESHOLD = 3;

/**
 * Duration in milliseconds to blacklist a key after hitting error threshold
 */
const BLACKLIST_DURATION_MS = 30 * 1000; // 30 seconds

/**
 * HTTP status codes that indicate permanent key issues (auth errors)
 */
const PERMANENT_ERROR_CODES = [401, 403];

/**
 * Get the health key identifier for a specific API key
 */
function getHealthKey(envVarName: string, keyIndex: number): string {
	return `${envVarName}:${keyIndex}`;
}

/**
 * Check if a specific API key is healthy and should be used
 * @param envVarName The environment variable name
 * @param keyIndex The index of the key in the comma-separated list
 * @returns true if the key is healthy, false if it should be skipped
 */
export function isKeyHealthy(envVarName: string, keyIndex: number): boolean {
	const healthKey = getHealthKey(envVarName, keyIndex);
	const health = keyHealthMap.get(healthKey);

	if (!health) {
		return true; // No health data = healthy
	}

	if (health.permanentlyBlacklisted) {
		return false;
	}

	if (health.consecutiveErrors >= ERROR_THRESHOLD) {
		// Check if blacklist period has expired
		const timeSinceError = Date.now() - health.lastErrorTime;
		if (timeSinceError < BLACKLIST_DURATION_MS) {
			return false;
		}
		// Reset after blacklist period expires
		health.consecutiveErrors = 0;
	}

	return true;
}

/**
 * Report a successful request for an API key
 * Resets the consecutive error counter
 */
export function reportKeySuccess(envVarName: string, keyIndex: number): void {
	const healthKey = getHealthKey(envVarName, keyIndex);
	const health = keyHealthMap.get(healthKey);

	if (health && !health.permanentlyBlacklisted) {
		health.consecutiveErrors = 0;
	}
}

/**
 * Report an error for an API key
 * Increments consecutive errors and may blacklist the key
 * @param statusCode The HTTP status code of the error (optional)
 */
export function reportKeyError(
	envVarName: string,
	keyIndex: number,
	statusCode?: number,
): void {
	const healthKey = getHealthKey(envVarName, keyIndex);
	let health = keyHealthMap.get(healthKey);

	if (!health) {
		health = {
			consecutiveErrors: 0,
			lastErrorTime: 0,
			permanentlyBlacklisted: false,
		};
		keyHealthMap.set(healthKey, health);
	}

	// Check for permanent auth errors
	if (statusCode && PERMANENT_ERROR_CODES.includes(statusCode)) {
		health.permanentlyBlacklisted = true;
		return;
	}

	health.consecutiveErrors++;
	health.lastErrorTime = Date.now();
}

/**
 * Get health status for a key (for debugging/monitoring)
 */
export function getKeyHealth(
	envVarName: string,
	keyIndex: number,
): KeyHealth | undefined {
	return keyHealthMap.get(getHealthKey(envVarName, keyIndex));
}

/**
 * Reset all health data (useful for testing)
 */
export function resetKeyHealth(): void {
	keyHealthMap.clear();
}

/**
 * Get count of all tracked keys (for monitoring)
 */
export function getTrackedKeyCount(): number {
	return keyHealthMap.size;
}
