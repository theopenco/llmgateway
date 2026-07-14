import { hasInvalidProviderCredentialError } from "@/lib/provider-auth-errors.js";

import { isContentFilterErrorText } from "@llmgateway/shared";

/**
 * Determines the appropriate finish reason based on HTTP status code and error message
 * 5xx status codes indicate upstream provider errors
 * 429 status codes indicate upstream rate limiting (treated as upstream error)
 * 404 status codes indicate model/endpoint not found at provider (treated as upstream error)
 * 401/403 status codes indicate authentication/authorization issues (gateway configuration errors)
 * Other 4xx status codes indicate client errors
 * Special client errors (like JSON format validation) are classified as client_error
 *
 * Note: Error classification is separate from health tracking. The health tracking system
 * (api-key-health.ts) independently handles 401/403 errors for uptime routing purposes
 * by permanently blacklisting keys with these status codes.
 */
export function getFinishReasonFromError(
	statusCode: number,
	errorText?: string,
): string {
	if (statusCode >= 500) {
		return "upstream_error";
	}

	// 429 is a rate limit from the upstream provider, not a client error
	if (statusCode === 429) {
		return "upstream_error";
	}

	// 404 from upstream provider indicates model/endpoint not found at provider
	if (statusCode === 404) {
		return "upstream_error";
	}

	// 402 Payment Required indicates the gateway's provider account is out of
	// funds (e.g. DeepSeek "Insufficient Balance"). This is a gateway-side
	// account problem, not a client error, so classify as gateway_error to allow
	// fallback to another provider.
	if (statusCode === 402) {
		return "gateway_error";
	}

	// Provider content-moderation / safety blocks (Azure ResponsibleAIPolicyViolation,
	// ByteDance/DeepSeek SensitiveContentDetected, Alibaba data_inspection_failed,
	// Azure content management policy, OpenAI safety system rejection, etc.)
	if (isContentFilterErrorText(errorText)) {
		return "content_filter";
	}

	// xAI (Grok) content safety violations (e.g. SAFETY_CHECK_TYPE_CSAM, usage guidelines)
	if (
		statusCode === 403 &&
		errorText?.includes("Content violates usage guidelines")
	) {
		return "content_filter";
	}

	// 401/403 and known provider credential payloads indicate bad provider keys.
	if (
		statusCode === 401 ||
		statusCode === 403 ||
		hasInvalidProviderCredentialError(errorText)
	) {
		return "gateway_error";
	}

	// Upstream reports the model id as unknown (e.g. Mistral / Together / Fireworks
	// returning `Unknown model: <name>` on a 400). This is a gateway-side mapping
	// gap rather than a client problem, so classify as gateway_error so the
	// request can be retried with another provider.
	if (errorText && /unknown model/i.test(errorText)) {
		return "gateway_error";
	}

	// Aggregator providers (e.g. embercloud) report transient failures of THEIR
	// upstreams as a 400 "Temporary routing error (400)." — a provider-side
	// failure, not a client error, so classify as upstream_error so the request
	// can be retried with another provider instead of passing the 400 through.
	if (errorText && /temporary routing error/i.test(errorText)) {
		return "upstream_error";
	}

	// Some providers return a bare "Not Found" body on non-404 status codes when
	// the model/endpoint mapping is wrong on our side. Treat as gateway_error so
	// the request can be retried with another provider.
	if (errorText?.trim() === "Not Found") {
		return "gateway_error";
	}

	// Azure returns a 400 when the resolved deployment does not exist for the
	// account behind the selected key (e.g. "Could not find an existing
	// deployment to match the model in the request."). This is a per-key/account
	// configuration gap rather than a client problem, so classify as
	// gateway_error so the request can be retried with another key or provider.
	if (
		errorText &&
		/could not find an existing deployment to match the model/i.test(errorText)
	) {
		return "gateway_error";
	}

	// Check for specific client validation errors from providers
	if (statusCode === 400 && errorText) {
		// OpenAI JSON format validation error
		if (
			errorText.includes("'messages' must contain") &&
			errorText.includes("the word 'json'")
		) {
			return "client_error";
		}
	}

	if (statusCode >= 400 && statusCode < 500) {
		return "client_error";
	}

	return "gateway_error";
}
