import { deriveStabilityMetrics } from "./stability-metrics.js";

import type { StabilityCounts } from "./stability-metrics.js";

/** Hours of the hourly rollup judged, the hour in progress included. */
export const FAILING_CREDENTIAL_WINDOW_HOURS = 4;
/** Error rate (percent, client errors excluded) at which a credential is failing. */
export const FAILING_CREDENTIAL_ERROR_RATE = 90;
/** Fewer requests than this in the window is noise, not a broken credential. */
export const FAILING_CREDENTIAL_MIN_REQUESTS = 10;

const HOUR_MS = 60 * 60 * 1000;

/** Start of the oldest hourly bucket in the window. */
export function failingCredentialWindowStart(now: Date = new Date()): Date {
	const currentHour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
	const offsetMs = (FAILING_CREDENTIAL_WINDOW_HOURS - 1) * HOUR_MS;
	return new Date(currentHour - offsetMs);
}

/** The credential's stability metrics when it is failing, otherwise null. */
export function getFailingCredentialRate(counts: StabilityCounts) {
	const { requestCount, errorsCount, errorRate } =
		deriveStabilityMetrics(counts);
	if (
		errorRate === null ||
		requestCount < FAILING_CREDENTIAL_MIN_REQUESTS ||
		errorRate < FAILING_CREDENTIAL_ERROR_RATE
	) {
		return null;
	}
	return { requestCount, errorsCount, errorRate };
}
