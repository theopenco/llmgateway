import {
	redactedProviderErrorText,
	shouldRedactProviderError,
} from "@/lib/stealth-provider-errors.js";

/**
 * Client-facing message for an upstream video provider error.
 * Stealth providers: never pass the raw upstream error body through
 * to the client — only the upstream status code may be surfaced.
 * Non-stealth providers keep the raw upstream message unchanged.
 */
export function clientFacingUpstreamMessage(
	providerId: string | undefined,
	statusCode: number,
	rawMessage: string,
): string {
	if (shouldRedactProviderError(providerId)) {
		return redactedProviderErrorText(statusCode);
	}
	return rawMessage;
}
