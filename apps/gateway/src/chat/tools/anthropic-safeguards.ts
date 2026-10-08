// Claude Code's auto mode asks Anthropic to review risky tool calls server-side,
// at no charge, by adding a `safeguards` body field and a paired beta header to
// its normal Messages API requests; the verdicts come back as
// `safeguard_results` (on the final `message_delta` when streaming). The
// /v1/messages layer lowers requests to the chat completions shape, which has
// nowhere to carry either half, so they ride on `anthropic_safeguards` and are
// restored here for the Anthropic API only. Without them Claude Code falls back
// to its own classifier requests, which bill as ordinary token usage.
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

// Restores the pair on an outgoing request. Only Anthropic's own API runs the
// review; every other transport gets neither half, so a fallback to another
// provider stays a valid request and Claude Code reverts to its own classifier.
export function applyAnthropicSafeguards(
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
	if (
		transportProvider !== "anthropic" ||
		!passthrough ||
		passthrough.safeguards.length === 0 ||
		betas.length === 0
	) {
		delete body.safeguards;
		return;
	}

	body.safeguards = passthrough.safeguards;
	const merged = parseBetaHeader(headers["anthropic-beta"]);
	for (const beta of betas) {
		if (!merged.includes(beta)) {
			merged.push(beta);
		}
	}
	headers["anthropic-beta"] = merged.join(",");
}
