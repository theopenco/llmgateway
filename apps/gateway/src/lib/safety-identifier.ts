import { z } from "@hono/zod-openapi";

import type { InferSelectModel, tables } from "@llmgateway/db";

/**
 * Client end-user identifier fields for endpoints without a native one. Only
 * recorded in log params.safety_identifier, never forwarded upstream.
 */
export const clientSafetyIdentifierFields = {
	safety_identifier: z.string().max(128).nullable().optional().openapi({
		description:
			"Opaque end-user identifier stored in log params.safety_identifier. Never forwarded upstream and never replaces LLM Gateway's provider-facing identifier.",
		example: "app-user-42",
	}),
	// A non-string user was stripped before this field existed; keep accepting it.
	user: z.unknown().optional().openapi({
		type: "string",
		description:
			"Legacy end-user identifier, recorded as params.safety_identifier when safety_identifier is absent and it is at most 128 characters. Never forwarded upstream.",
	}),
};

export function getClientSafetyIdentifierParams(body: unknown): {
	safety_identifier?: string;
} {
	if (!body || typeof body !== "object") {
		return {};
	}
	const request = body as Record<string, unknown>;
	const value = request.safety_identifier ?? request.user;
	// Code points, as zod's .max(128) counts them.
	return typeof value === "string" &&
		value.length > 0 &&
		Array.from(value).length <= 128
		? { safety_identifier: value }
		: {};
}

/**
 * The identifier fields of a parsed multipart form. An empty
 * safety_identifier stays empty, so it does not fall back to user.
 */
export function formSafetyIdentifierFields(form: Record<string, unknown>): {
	safety_identifier: unknown;
	user: unknown;
} {
	const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
	return {
		safety_identifier: first(form.safety_identifier),
		user: first(form.user),
	};
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
