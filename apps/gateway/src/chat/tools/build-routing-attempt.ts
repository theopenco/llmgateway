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
		providerKeyId?: string;
		providerKeyLabel?: string;
		logId?: string;
	},
): RoutingAttempt {
	// A key identity is only ever attached to a BYOK attempt: the caller reads
	// it off its own provider-key row, and providerKeyLabel() returns undefined
	// for platform credentials. Guarding here too means a future call site
	// cannot leak one by passing the wrong row.
	const isByok = options?.credentialSource === "byok";

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
		...(isByok && options?.providerKeyId
			? { providerKeyId: options.providerKeyId }
			: {}),
		...(isByok && options?.providerKeyLabel
			? { providerKeyLabel: options.providerKeyLabel }
			: {}),
		...(options?.logId && { logId: options.logId }),
	};
}
