import { STATUS_CODES } from "node:http";

import { isStealthProvider } from "@llmgateway/models";

import type { errorDetails } from "@llmgateway/db";
import type { ProviderId } from "@llmgateway/models";
import type { z } from "zod";

type ErrorDetails = z.infer<typeof errorDetails>;

/**
 * Whether upstream error payloads from this provider must be redacted before
 * reaching clients or publicly visible log fields. Stealth providers run on
 * undisclosed platforms whose raw error bodies (and network error messages,
 * which can embed the secret base URL) would reveal their identity, so only
 * the upstream HTTP status code may be surfaced publicly. The raw error is
 * preserved in the log table's internal-only `internalErrorDetails` column.
 */
export function shouldRedactProviderError(
	provider: string | null | undefined,
): boolean {
	if (!provider) {
		return false;
	}
	return isStealthProvider(provider as ProviderId);
}

export function canonicalStatusText(statusCode: number): string {
	return STATUS_CODES[statusCode] ?? "";
}

/**
 * Generic replacement for a stealth provider's raw error body: carries only
 * the upstream HTTP status.
 */
export function redactedProviderErrorText(statusCode: number): string {
	const statusText = canonicalStatusText(statusCode);
	return `Upstream provider error (${statusCode}${statusText ? ` ${statusText}` : ""})`;
}

/**
 * Publicly visible errorDetails for a stealth provider: only the upstream
 * status code survives; the status text is replaced with the canonical HTTP
 * reason phrase since upstream reason phrases are provider-controlled.
 */
export function redactErrorDetails(details: ErrorDetails): ErrorDetails {
	return {
		statusCode: details.statusCode,
		statusText: canonicalStatusText(details.statusCode),
		responseText: redactedProviderErrorText(details.statusCode),
	};
}

/**
 * Client-facing message for a network-level upstream failure (timeout,
 * connection refused, socket reset). Node/undici error messages can embed the
 * upstream hostname, which for stealth providers is the secret base URL, so
 * only the generic prefix is returned for them.
 */
export function clientFacingUpstreamFailureMessage(
	provider: string,
	prefix: string,
	errorMessage: string,
): string {
	return shouldRedactProviderError(provider)
		? prefix
		: `${prefix}: ${errorMessage}`;
}

/**
 * Client-facing `message`/`responseText` pair for an upstream HTTP error.
 * Non-stealth providers pass the raw upstream body through unchanged.
 */
export function buildUpstreamErrorClientPayload(
	provider: string,
	statusCode: number,
	statusText: string,
	rawResponseText: string,
): { message: string; responseText: string } {
	if (shouldRedactProviderError(provider)) {
		const responseText = redactedProviderErrorText(statusCode);
		return {
			message: `Error from provider ${provider}: ${statusCode} ${canonicalStatusText(statusCode)}`,
			responseText,
		};
	}
	return {
		message: `Error from provider ${provider}: ${statusCode} ${statusText} ${rawResponseText}`,
		responseText: rawResponseText,
	};
}
