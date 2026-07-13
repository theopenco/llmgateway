import type { RoutingAttempt } from "./retry-with-fallback.js";

export function buildRoutingAttempt(
	provider: string,
	model: string,
	statusCode: number,
	errorType: string,
	succeeded: boolean,
	options?: {
		region?: string;
		apiKeyHash?: string;
		logId?: string;
	},
): RoutingAttempt {
	return {
		provider,
		model,
		...(options?.region && { region: options.region }),
		status_code: statusCode,
		error_type: errorType,
		succeeded,
		...(options?.apiKeyHash && { apiKeyHash: options.apiKeyHash }),
		...(options?.logId && { logId: options.logId }),
	};
}
