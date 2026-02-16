/**
 * In-memory API key health tracking for uptime-aware routing
 * Tracks historical error rates per API key using a sliding window approach
 *
 * This module provides:
 * - Sliding window tracking of success/error counts (default: 5 minutes)
 * - Uptime calculation (success rate percentage)
 * - Temporary blacklisting after consecutive errors
 * - Permanent blacklisting for auth errors (401/403)
 *
 * Note: Health tracking is separate from error classification (get-finish-reason-from-error.ts).
 * While 401/403 errors are classified as "gateway_error" for logging purposes,
 * they are still tracked here for uptime routing to permanently blacklist invalid keys.
 */

/**
 * Represents a single request outcome with timestamp
 */
interface RequestOutcome {
	timestamp: number;
	success: boolean;
}

export interface KeyHealth {
	consecutiveErrors: number;
	lastErrorTime: number;
	permanentlyBlacklisted: boolean;
	/**
	 * Rolling history of request outcomes for uptime calculation
	 */
	history: RequestOutcome[];
}

export interface KeyMetrics {
	uptime: number; // Percentage (0-100)
	totalRequests: number;
	consecutiveErrors: number;
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
 * Duration in milliseconds for the sliding window (5 minutes)
 */
const METRICS_WINDOW_MS = 5 * 60 * 1000;

/**
 * Maximum number of history entries to keep per key (prevents memory bloat)
 * With typical request rates, this should cover well beyond the 5-minute window
 */
const MAX_HISTORY_SIZE = 1000;

/**
 * HTTP status codes that indicate permanent key issues (auth errors)
 */
const PERMANENT_ERROR_CODES = [401, 403];

/**
 * Error messages that indicate permanent key issues
 */
const PERMANENT_ERROR_MESSAGES = [
	"API Key not found. Please pass a valid API key.",
];

/**
 * Uptime threshold below which exponential penalty kicks in
 */
export const UPTIME_PENALTY_THRESHOLD = 95;

/**
 * Get the health key identifier for a specific API key
 */
function getHealthKey(envVarName: string, keyIndex: number): string {
	return `${envVarName}:${keyIndex}`;
}

/**
 * Prune old entries from history that are outside the metrics window
 */
function pruneHistory(health: KeyHealth, now: number): void {
	const cutoff = now - METRICS_WINDOW_MS;
	// Remove entries older than the window
	while (health.history.length > 0 && health.history[0].timestamp < cutoff) {
		health.history.shift();
	}
	// Also enforce max size limit
	while (health.history.length > MAX_HISTORY_SIZE) {
		health.history.shift();
	}
}

/**
 * Calculate uptime percentage from recent history
 * @returns Uptime as percentage (0-100), or 100 if no history
 */
function calculateUptime(health: KeyHealth, now: number): number {
	pruneHistory(health, now);

	if (health.history.length === 0) {
		return 100; // Assume 100% uptime if no data
	}

	const successCount = health.history.filter((h) => h.success).length;
	return (successCount / health.history.length) * 100;
}

/**
 * Calculate exponential penalty for low uptime.
 * - 95-100% uptime: no penalty (returns 0)
 * - Below 95%: exponential penalty that increases rapidly
 *   - 90% -> ~0.07 penalty
 *   - 80% -> ~0.62 penalty
 *   - 70% -> ~1.73 penalty
 *   - 60% -> ~3.39 penalty
 *   - 50% -> ~5.61 penalty
 */
export function calculateUptimePenalty(uptime: number): number {
	if (uptime >= UPTIME_PENALTY_THRESHOLD) {
		return 0;
	}
	// Calculate how far below threshold (0-95 range, normalized to 0-1)
	const deficit =
		(UPTIME_PENALTY_THRESHOLD - uptime) / UPTIME_PENALTY_THRESHOLD;
	// Quadratic penalty: small dips = small penalty, large dips = large penalty
	return Math.pow(deficit * 5, 2);
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
 * Get metrics for a specific API key
 * @returns KeyMetrics with uptime, request count, and health status
 */
export function getKeyMetrics(
	envVarName: string,
	keyIndex: number,
): KeyMetrics {
	const healthKey = getHealthKey(envVarName, keyIndex);
	const health = keyHealthMap.get(healthKey);

	if (!health) {
		return {
			uptime: 100,
			totalRequests: 0,
			consecutiveErrors: 0,
			permanentlyBlacklisted: false,
		};
	}

	const now = Date.now();
	pruneHistory(health, now);

	return {
		uptime: calculateUptime(health, now),
		totalRequests: health.history.length,
		consecutiveErrors: health.consecutiveErrors,
		permanentlyBlacklisted: health.permanentlyBlacklisted,
	};
}

/**
 * Get metrics for all keys of an environment variable
 * @param envVarName The environment variable name
 * @param keyCount The number of keys in the comma-separated list
 * @returns Array of KeyMetrics for each key index
 */
export function getAllKeyMetrics(
	envVarName: string,
	keyCount: number,
): KeyMetrics[] {
	const metrics: KeyMetrics[] = [];
	for (let i = 0; i < keyCount; i++) {
		metrics.push(getKeyMetrics(envVarName, i));
	}
	return metrics;
}

/**
 * Report a successful request for an API key
 * Resets the consecutive error counter and adds to history
 */
export function reportKeySuccess(envVarName: string, keyIndex: number): void {
	const healthKey = getHealthKey(envVarName, keyIndex);
	let health = keyHealthMap.get(healthKey);

	const now = Date.now();

	if (!health) {
		health = {
			consecutiveErrors: 0,
			lastErrorTime: 0,
			permanentlyBlacklisted: false,
			history: [],
		};
		keyHealthMap.set(healthKey, health);
	}

	if (!health.permanentlyBlacklisted) {
		health.consecutiveErrors = 0;
	}

	// Add success to history
	health.history.push({ timestamp: now, success: true });
	pruneHistory(health, now);
}

/**
 * Report an error for an API key
 * Increments consecutive errors, adds to history, and may blacklist the key
 * @param statusCode The HTTP status code of the error (optional)
 * @param errorText The error message text (optional)
 */
export function reportKeyError(
	envVarName: string,
	keyIndex: number,
	statusCode?: number,
	errorText?: string,
): void {
	const healthKey = getHealthKey(envVarName, keyIndex);
	let health = keyHealthMap.get(healthKey);

	const now = Date.now();

	if (!health) {
		health = {
			consecutiveErrors: 0,
			lastErrorTime: 0,
			permanentlyBlacklisted: false,
			history: [],
		};
		keyHealthMap.set(healthKey, health);
	}

	// Check for permanent auth errors by status code
	if (statusCode && PERMANENT_ERROR_CODES.includes(statusCode)) {
		health.permanentlyBlacklisted = true;
		// Still add to history for metrics visibility
		health.history.push({ timestamp: now, success: false });
		pruneHistory(health, now);
		return;
	}

	// Check for permanent auth errors by error message
	if (
		errorText &&
		PERMANENT_ERROR_MESSAGES.some((msg) => errorText.includes(msg))
	) {
		health.permanentlyBlacklisted = true;
		// Still add to history for metrics visibility
		health.history.push({ timestamp: now, success: false });
		pruneHistory(health, now);
		return;
	}

	health.consecutiveErrors++;
	health.lastErrorTime = now;

	// Add error to history
	health.history.push({ timestamp: now, success: false });
	pruneHistory(health, now);
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
