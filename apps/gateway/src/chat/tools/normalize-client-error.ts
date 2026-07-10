interface ClientErrorContext {
	usedProvider: string;
	finishReason: string;
	status: number;
	statusText: string;
	requestedProvider?: string;
	requestedModel?: string;
	usedInternalModel?: string;
}

/**
 * Ensure a provider's client-error (4xx) body is returned in the OpenAI
 * `{ error: { ... } }` envelope.
 *
 * OpenAI-compatible providers already return that shape, so their body is passed
 * through unchanged. Providers like AWS Bedrock return a bare `{ "message": ... }`
 * (or other non-OpenAI shapes), which breaks OpenAI-compatible clients that
 * validate the response against `{ choices } | { error }` — those are wrapped
 * into the standard envelope instead of leaking raw.
 */
export function normalizeClientErrorBody(
	errorResponseText: string,
	context: ClientErrorContext,
): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(errorResponseText);
	} catch {
		parsed = undefined;
	}

	// Already OpenAI-shaped (`error` is an object): pass through unchanged.
	if (
		parsed &&
		typeof parsed === "object" &&
		typeof (parsed as Record<string, unknown>).error === "object" &&
		(parsed as Record<string, unknown>).error !== null
	) {
		return parsed as Record<string, unknown>;
	}

	const record =
		parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: undefined;
	const candidate =
		record?.message ?? record?.Message ?? record?.error ?? errorResponseText;
	const message =
		typeof candidate === "string" && candidate.length > 0
			? candidate
			: typeof candidate === "string"
				? `Error from provider ${context.usedProvider}: ${context.status} ${context.statusText}`
				: JSON.stringify(candidate);

	return {
		error: {
			message,
			type: context.finishReason,
			param: null,
			code: context.finishReason,
			requestedProvider: context.requestedProvider,
			usedProvider: context.usedProvider,
			requestedModel: context.requestedModel,
			usedInternalModel: context.usedInternalModel,
			responseText: errorResponseText,
		},
	};
}
