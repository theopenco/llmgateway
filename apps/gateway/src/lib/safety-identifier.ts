import type { InferSelectModel, tables } from "@llmgateway/db";

export function getClientSafetyIdentifierParams(body: unknown): {
	safety_identifier?: string;
} {
	if (!body || typeof body !== "object") {
		return {};
	}
	const request = body as Record<string, unknown>;
	const value = request.safety_identifier ?? request.user;
	return typeof value === "string" && value.length > 0 && value.length <= 128
		? { safety_identifier: value }
		: {};
}
/** Applies the managed credential setting; callers omit identifiers for BYOK. */
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
