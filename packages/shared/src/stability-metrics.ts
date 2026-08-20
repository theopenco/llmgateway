export interface StabilityMetrics {
	requestCount: number;
	errorsCount: number;
	errorRate: number | null;
	uptime: number | null;
}

export function deriveStabilityMetrics(
	logsCount: number,
	errorsCount: number,
	clientErrorsCount: number,
): StabilityMetrics {
	const normalizedLogs = Math.max(logsCount, 0);
	const normalizedClientErrors = Math.min(
		Math.max(clientErrorsCount, 0),
		normalizedLogs,
	);
	const requestCount = normalizedLogs - normalizedClientErrors;
	const stabilityErrors = Math.min(
		Math.max(errorsCount - normalizedClientErrors, 0),
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
