import type { InferSelectModel, tables } from "@llmgateway/db";

/**
 * The API key's safety identifier to send upstream, or undefined when the
 * organization's provider key serving the request has forwarding turned off.
 */
export function forwardedSafetyIdentifier(
	providerKey:
		| Pick<
				InferSelectModel<typeof tables.providerKey>,
				"forwardSafetyIdentifier"
		  >
		| null
		| undefined,
	safetyIdentifier: string,
): string | undefined {
	return providerKey?.forwardSafetyIdentifier === false
		? undefined
		: safetyIdentifier;
}
