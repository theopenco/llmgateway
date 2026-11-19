import { getProviderDefinition } from "@llmgateway/models";

import type { ProviderModelMapping } from "@llmgateway/models";

// Claude Code's auto mode asks Anthropic to review risky tool calls server-side,
// at no charge, by adding a `safeguards` body field and a paired beta header to
// its normal Messages API requests; the verdicts come back as
// `safeguard_results` (on the final `message_delta` when streaming). The
// /v1/messages layer lowers requests to the chat completions shape, which has
// nowhere to carry either half, so they ride on `anthropic_safeguards` and are
// restored here for providers that run the review: as-is on Messages API
// transports, inside the model request fields on Bedrock Converse. Without them
// Claude Code falls back to its own classifier requests, which bill as ordinary
// token usage.
// https://code.claude.com/docs/en/auto-mode-classifier-billing

// Beta families that pair with the `safeguards` field, matched by family and
// date so a new dated revision keeps working without a gateway release while
// arbitrary values never reach the upstream header.
const SAFEGUARD_BETA_PATTERN =
	/^(?:dangerous-tool-use|auto-mode-classifier)-\d{4}-\d{2}-\d{2}$/;

export interface AnthropicSafeguardsPassthrough {
	safeguards: Array<Record<string, unknown>>;
	betas: string[];
}

export function isSafeguardBeta(value: string): boolean {
	return SAFEGUARD_BETA_PATTERN.test(value);
}

export function providerSupportsAnthropicSafeguards(
	providerId: string,
): boolean {
	return getProviderDefinition(providerId)?.anthropicSafeguards === true;
}

// Bedrock also serves non-Claude models; only its Claude mappings (`anthropic.`
// model ids, on Converse or Bedrock's Messages endpoint) run the review.
export function mappingSupportsAnthropicSafeguards(
	mapping: Pick<
		ProviderModelMapping,
		"providerId" | "externalId" | "apiFormat"
	>,
): boolean {
	if (!providerSupportsAnthropicSafeguards(mapping.providerId)) {
		return false;
	}
	if (mapping.providerId !== "aws-bedrock") {
		return true;
	}
	return (
		mapping.externalId.startsWith("anthropic.") &&
		(mapping.apiFormat === undefined ||
			mapping.apiFormat === "provider-native" ||
			mapping.apiFormat === "anthropic-messages")
	);
}

export function parseBetaHeader(header: string | null | undefined): string[] {
	if (!header) {
		return [];
	}
	return header
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

// The request half to forward, or undefined. The body field and its beta only
// travel together: either one alone is a hard 400 from Anthropic, while both
// absent just turns the feature off and Claude Code falls back quietly.
export function extractAnthropicSafeguards(
	safeguards: unknown,
	betaHeader: string | null | undefined,
): AnthropicSafeguardsPassthrough | undefined {
	if (!Array.isArray(safeguards) || safeguards.length === 0) {
		return undefined;
	}
	const betas = parseBetaHeader(betaHeader).filter(isSafeguardBeta);
	if (betas.length === 0) {
		return undefined;
	}
	return {
		safeguards: safeguards as Array<Record<string, unknown>>,
		betas,
	};
}

// Restores the pair on an outgoing request to Anthropic or Claude on AWS
// Bedrock (Messages API or Converse) and strips it everywhere else. Routing
// excludes other providers when this pair is requested.
export function applyAnthropicSafeguards(
	usedProvider: string,
	transportProvider: string,
	requestBody: unknown,
	headers: Record<string, string>,
	passthrough: AnthropicSafeguardsPassthrough | undefined,
): void {
	if (
		requestBody === null ||
		typeof requestBody !== "object" ||
		requestBody instanceof FormData
	) {
		return;
	}
	const body = requestBody as Record<string, unknown>;
	const betas = passthrough?.betas.filter(isSafeguardBeta) ?? [];
	const safeguards =
		passthrough && passthrough.safeguards.length > 0 && betas.length > 0
			? passthrough.safeguards
			: undefined;

	// Anthropic, or Bedrock's Messages endpoint: same body field and header.
	if (
		safeguards &&
		transportProvider === "anthropic" &&
		(usedProvider === "anthropic" || usedProvider === "aws-bedrock")
	) {
		body.safeguards = safeguards;
		headers["anthropic-beta"] = mergeValues(
			parseBetaHeader(headers["anthropic-beta"]),
			betas,
		).join(",");
		return;
	}

	delete body.safeguards;

	// Bedrock Converse carries both halves in additionalModelRequestFields and
	// returns the verdicts only when asked: at `/safeguard_results` on
	// `converse`, and at `/delta/safeguard_results` on `converse-stream`'s
	// messageStop event. Unmatched paths are ignored, so both are requested.
	if (safeguards && transportProvider === "aws-bedrock") {
		const fields = (body.additionalModelRequestFields ??= {}) as Record<
			string,
			unknown
		>;
		fields.safeguards = safeguards;
		fields.anthropic_beta = mergeValues(
			Array.isArray(fields.anthropic_beta) ? fields.anthropic_beta : [],
			betas,
		);
		body.additionalModelResponseFieldPaths = mergeValues(
			Array.isArray(body.additionalModelResponseFieldPaths)
				? body.additionalModelResponseFieldPaths
				: [],
			BEDROCK_SAFEGUARD_RESULT_PATHS,
		);
	}
}

const BEDROCK_SAFEGUARD_RESULT_PATHS = [
	"/safeguard_results",
	"/delta/safeguard_results",
];

function mergeValues(existing: unknown[], additions: string[]): unknown[] {
	const merged = [...existing];
	for (const value of additions) {
		if (!merged.includes(value)) {
			merged.push(value);
		}
	}
	return merged;
}

/**
 * Safeguard verdicts from a Bedrock Converse response or converse-stream
 * messageStop event, or undefined when there are none.
 */
export function extractBedrockSafeguardResults(
	additionalModelResponseFields: unknown,
): unknown[] | undefined {
	if (
		additionalModelResponseFields === null ||
		typeof additionalModelResponseFields !== "object"
	) {
		return undefined;
	}
	const fields = additionalModelResponseFields as {
		safeguard_results?: unknown;
		delta?: { safeguard_results?: unknown };
	};
	const results = fields.safeguard_results ?? fields.delta?.safeguard_results;
	return Array.isArray(results) && results.length > 0 ? results : undefined;
}
