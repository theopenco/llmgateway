import { logRealtimeClientError } from "@/lib/client-error-log.js";

import { shortid } from "@llmgateway/db";

/**
 * HTTP status an equivalent HTTP request would have been rejected with, which
 * also drives the log's error category. Unlisted denials are permission ones.
 */
const DENIAL_STATUS: Record<string, number> = {
	api_key_revoked: 401,
	api_key_limit: 401,
	project_archived: 410,
	insufficient_credits: 402,
	session_spend_limit: 402,
	spend_cap_reached: 429,
	rate_limit_exceeded: 429,
	gate_unavailable: 503,
};

export interface RealtimeTurnDenial {
	gatewayToken: string;
	sessionRecordId: string;
	requestedModel: string;
	source: string | null;
	userAgent: string | undefined;
	code: string;
	message: string;
}

/**
 * Logs a billable turn refused inside an open realtime session as a client
 * error. Gateway-side failures (5xx) are not the caller's and are skipped.
 */
export async function logRealtimeTurnDenial(
	denial: RealtimeTurnDenial,
): Promise<void> {
	const statusCode = DENIAL_STATUS[denial.code] ?? 403;
	if (statusCode >= 500) {
		return;
	}
	await logRealtimeClientError({
		apiOrigin: "realtime",
		token: denial.gatewayToken,
		requestId: `${denial.sessionRecordId}:${shortid(12)}`,
		requestedModel: denial.requestedModel,
		source: denial.source,
		userAgent: denial.userAgent,
		customHeaders: {},
		message: denial.message,
		cause: denial.code,
		statusCode,
	});
}
