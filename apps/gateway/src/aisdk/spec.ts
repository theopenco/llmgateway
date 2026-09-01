/**
 * Spec-version handling for the AI SDK Gateway protocol surface.
 *
 * `@ai-sdk/gateway` announces which `LanguageModelV*` specification the calling
 * AI SDK expects via the `ai-language-model-specification-version` header:
 * `2` = AI SDK 5, `3` = AI SDK 6, `4` = AI SDK 7. The wire shapes differ in two
 * places that matter, so every response has to be built for the requested
 * version rather than for one canonical shape.
 */

/** Specification versions this surface can answer for. */
export const SUPPORTED_SPEC_VERSIONS = [2, 3, 4] as const;

export type SpecVersion = (typeof SUPPORTED_SPEC_VERSIONS)[number];

/**
 * What `@ai-sdk/gateway@4.x` (AI SDK 7) sends. Requests without the header come
 * from a client that predates it or from a hand-rolled caller; answering with
 * the newest shape matches the version the default `baseURL` (`/v4/ai`) implies.
 */
export const DEFAULT_SPEC_VERSION: SpecVersion = 4;

export function parseSpecVersion(header: string | undefined): SpecVersion {
	const parsed = Number.parseInt((header ?? "").trim(), 10);
	return SUPPORTED_SPEC_VERSIONS.includes(parsed as SpecVersion)
		? (parsed as SpecVersion)
		: DEFAULT_SPEC_VERSION;
}

/**
 * Provider (server-executed) tools are `provider-defined` in v2 and `provider`
 * from v3 on. Both carry the same `{ id, name, args }` payload.
 */
export function isProviderToolType(type: unknown): boolean {
	return type === "provider" || type === "provider-defined";
}

export interface TokenCounts {
	inputTokens: number | undefined;
	outputTokens: number | undefined;
	totalTokens: number | undefined;
	reasoningTokens: number | undefined;
	cachedInputTokens: number | undefined;
	cacheWriteTokens: number | undefined;
}

/**
 * v2 reports usage flat; v3 and v4 nest it into input/output groups. Getting
 * this wrong does not throw — the AI SDK parses stream parts with `z.any()` —
 * it silently reports zero tokens, so it is keyed strictly off the header.
 */
export function buildUsage(
	specVersion: SpecVersion,
	tokens: TokenCounts,
): Record<string, unknown> {
	if (specVersion === 2) {
		return {
			inputTokens: tokens.inputTokens,
			outputTokens: tokens.outputTokens,
			totalTokens: tokens.totalTokens,
			...(tokens.reasoningTokens !== undefined && {
				reasoningTokens: tokens.reasoningTokens,
			}),
			...(tokens.cachedInputTokens !== undefined && {
				cachedInputTokens: tokens.cachedInputTokens,
			}),
		};
	}

	const cacheRead = tokens.cachedInputTokens;
	const cacheWrite = tokens.cacheWriteTokens;
	const noCache =
		tokens.inputTokens === undefined
			? undefined
			: Math.max(0, tokens.inputTokens - (cacheRead ?? 0) - (cacheWrite ?? 0));

	return {
		inputTokens: {
			total: tokens.inputTokens,
			noCache,
			cacheRead,
			cacheWrite,
		},
		outputTokens: {
			total: tokens.outputTokens,
			// The reasoning token count is already part of the output total for
			// every provider after usage normalization; `text` is the remainder.
			text:
				tokens.outputTokens === undefined
					? undefined
					: Math.max(0, tokens.outputTokens - (tokens.reasoningTokens ?? 0)),
			reasoning: tokens.reasoningTokens,
		},
	};
}

export type SpecWarning = Record<string, unknown>;

/** v2 uses `unsupported-setting`; v3/v4 collapsed everything into `unsupported`. */
export function unsupportedSettingWarning(
	specVersion: SpecVersion,
	setting: string,
	details?: string,
): SpecWarning {
	return specVersion === 2
		? { type: "unsupported-setting", setting, ...(details && { details }) }
		: { type: "unsupported", feature: setting, ...(details && { details }) };
}

/** v2 carries the offending tool object; v3/v4 only carry a feature string. */
export function unsupportedToolWarning(
	specVersion: SpecVersion,
	tool: Record<string, unknown>,
	details?: string,
): SpecWarning {
	return specVersion === 2
		? { type: "unsupported-tool", tool, ...(details && { details }) }
		: {
				type: "unsupported",
				feature: `tool.${String(tool.id ?? tool.name ?? "unknown")}`,
				...(details && { details }),
			};
}
