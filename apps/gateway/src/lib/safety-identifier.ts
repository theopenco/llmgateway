import type { InferSelectModel, tables } from "@llmgateway/db";

/**
 * The API key's safety identifier to send upstream, or undefined when the
 * platform-managed credential serving the request has forwarding turned off.
 * Only managed credentials carry the setting; organization keys always forward.
 */
export function forwardedSafetyIdentifier(
	managedKey:
		| Pick<
				InferSelectModel<typeof tables.providerKey>,
				"managed" | "forwardSafetyIdentifier"
		  >
		| null
		| undefined,
	safetyIdentifier: string,
): string | undefined {
	return managedKey?.managed === true &&
		managedKey.forwardSafetyIdentifier === false
		? undefined
		: safetyIdentifier;
}
