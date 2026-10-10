export interface StabilityMetrics {
	requestCount: number;
	errorsCount: number;
	errorRate: number | null;
	uptime: number | null;
}

export interface StabilityCounts {
	logsCount: number;
	clientErrorsCount: number;
	gatewayErrorsCount: number;
	upstreamErrorsCount: number;
}

/**
 * Stability (error rate / uptime) counts only the errors we caused or the
 * provider caused: gateway and upstream errors. Client errors are excluded from
 * both sides of the ratio — a malformed request is not downtime.
 *
 * Deliberately derived from the unified finish-reason breakdown rather than
 * from the raw `errorsCount` (`log.hasError`) column: the two disagree in both
 * directions. A provider that answers 200 but ends the stream with an
 * upstream-error finish reason (e.g. `abort`) is classified `upstream_error`
 * with `hasError = false`, so subtracting client errors from `hasError` hid
 * those outages entirely and reported 100% uptime next to a non-zero upstream
 * error count.
 */
export function deriveStabilityMetrics({
	logsCount,
	clientErrorsCount,
	gatewayErrorsCount,
	upstreamErrorsCount,
}: StabilityCounts): StabilityMetrics {
	const normalizedLogs = Math.max(logsCount, 0);
	const normalizedClientErrors = Math.min(
		Math.max(clientErrorsCount, 0),
		normalizedLogs,
	);
	const requestCount = normalizedLogs - normalizedClientErrors;
	const stabilityErrors = Math.min(
		Math.max(gatewayErrorsCount, 0) + Math.max(upstreamErrorsCount, 0),
		requestCount,
	);

	if (requestCount === 0) {
		return {
			requestCount,
			errorsCount: stabilityErrors,
			errorRate: null,
			uptime: null,
		};
	}

	const errorRate = (stabilityErrors / requestCount) * 100;
	return {
		requestCount,
		errorsCount: stabilityErrors,
		errorRate,
		uptime: 100 - errorRate,
	};
}
