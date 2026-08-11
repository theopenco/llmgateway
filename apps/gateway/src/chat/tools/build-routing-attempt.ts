import type { RoutingAttempt } from "./retry-with-fallback.js";
import type { RoutingCredentialSource } from "@llmgateway/shared/routing-telemetry";

export function buildRoutingAttempt(
	provider: string,
	model: string,
	statusCode: number,
	errorType: string,
	succeeded: boolean,
	options?: {
		region?: string;
		apiKeyHash?: string;
		credentialSource?: RoutingCredentialSource;
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
		...(options?.credentialSource && {
			credentialSource: options.credentialSource,
		}),
		...(options?.logId && { logId: options.logId }),
	};
}
