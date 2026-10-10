import { hasInvalidProviderCredentialError } from "@/lib/provider-auth-errors.js";
import { hasExhaustedProviderAccountError } from "@/lib/provider-funding-errors.js";

import { isContentFilterErrorText } from "@llmgateway/shared";

// The message must open with the model as its subject, followed by at most one
// id token and then the phrase, so errors that merely mention a model ("model
// x: image file not found", "the file for this model does not exist") stay
// client errors.
const MODEL_DOES_NOT_EXIST_PATTERNS = [
	/(?:^|")\s*(?:the\s+)?(?:requested\s+)?model(?:\s+[`'"\\]*[\w.:@/-]+[`'"\\]*)?\s+(?:does not exist|doesn't exist|(?:is |was )?not found)\b/i,
	/(?:^|")\s*no such model\b/i,
	/"model_not_found"/,
];

/**
 * Determines the appropriate finish reason based on HTTP status code and error message
 * 5xx status codes indicate upstream provider errors
 * 429 status codes indicate upstream rate limiting (treated as upstream error)
 * 404 status codes indicate model/endpoint not found at provider (treated as upstream error)
 * 401/403 status codes indicate authentication/authorization issues (gateway configuration errors)
 * 405 status codes indicate the upstream rejected the request method (gateway endpoint mapping error)
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

	// This restriction belongs to the upstream account, even on a 4xx response.
	if (
		errorText &&
		/access to anthropic models is not allowed for this account/i.test(
			errorText,
		)
	) {
		return "upstream_error";
	}

	// 402 Payment Required indicates the gateway's provider account is out of
	// funds (e.g. DeepSeek "Insufficient Balance"). This is a gateway-side
	// account problem, not a client error, so classify as gateway_error to allow
	// fallback to another provider.
	if (statusCode === 402) {
		return "gateway_error";
	}

	// 405 Method Not Allowed means the upstream rejected the HTTP method the
	// gateway used — a gateway-side endpoint/method mapping problem for the
	// selected provider or key, never a client fault, so classify as
	// gateway_error so the request can be retried with another key or provider.
	if (statusCode === 405) {
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

	// Some providers report an exhausted gateway-side provider account with a 4xx
	// other than 402 (e.g. Anthropic returns a 400 `invalid_request_error` with
	// "Your credit balance is too low to access the Anthropic API."). Like the 402
	// case above this is a funding problem on our provider account, not a client
	// fault, so classify as gateway_error to allow fallback to another key or
	// provider.
	if (hasExhaustedProviderAccountError(errorText)) {
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

	// Some providers (e.g. novita) intermittently reject a request with a bare,
	// non-actionable 4xx — `{"message":"invalid request error trace_id: <hex>"}`
	// with no param and no reason — while the identical request succeeds moments
	// later or on another provider's mapping for the same model. That is a
	// transient provider-side failure, not a client fault, so classify as
	// upstream_error so the request can be retried with another provider and the
	// failure counts toward stability metrics (client errors are excluded from
	// uptime, which left these providers looking healthy and pinned sessions
	// stuck on them).
	if (
		errorText &&
		/invalid request error trace_id:\s*[0-9a-f]{32}/i.test(errorText)
	) {
		return "upstream_error";
	}

	// Upstream says the model it was sent does not exist (e.g. Runware's 400
	// "The model `<id>` does not exist"). The gateway validated the requested
	// model before routing, so the provider's deployment is at fault; classify as
	// upstream_error so the request can be retried with another provider.
	if (
		errorText &&
		MODEL_DOES_NOT_EXIST_PATTERNS.some((pattern) => pattern.test(errorText))
	) {
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
