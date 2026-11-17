import { getProviderDefinition } from "./providers.js";

import type { ProviderModelMapping } from "./models.js";

/**
 * Search engines the gateway runs itself for chat mappings without native web
 * search (`usesGatewayWebSearch`). An organization picks one
 * (`organization.webSearchEngine`), else the default. `price` is billed per
 * search, in USD.
 */
export const GATEWAY_WEB_SEARCH_ENGINES = {
	perplexity: { name: "Perplexity", price: "0.005" },
	exa: { name: "Exa", price: "0.007" },
} as const satisfies Record<string, { name: string; price: string }>;

export type GatewayWebSearchEngine = keyof typeof GATEWAY_WEB_SEARCH_ENGINES;

export const GATEWAY_WEB_SEARCH_ENGINE_IDS = Object.keys(
	GATEWAY_WEB_SEARCH_ENGINES,
) as [GatewayWebSearchEngine, ...GatewayWebSearchEngine[]];

export const DEFAULT_GATEWAY_WEB_SEARCH_ENGINE: GatewayWebSearchEngine =
	"perplexity";

export function isGatewayWebSearchEngine(
	value: unknown,
): value is GatewayWebSearchEngine {
	return typeof value === "string" && value in GATEWAY_WEB_SEARCH_ENGINES;
}

type WebSearchMapping = Pick<
	ProviderModelMapping,
	| "webSearch"
	| "imageGenerations"
	| "videoGenerations"
	| "embeddings"
	| "speechGenerations"
	| "realtime"
>;

/**
 * Whether the gateway runs web search for this mapping: a chat mapping whose
 * upstream has no native search. The gateway searches the caller's latest
 * user message, adds the results to that message, and returns them as
 * `url_citation` annotations.
 */
export function usesGatewayWebSearch(mapping: WebSearchMapping): boolean {
	return (
		mapping.webSearch !== true &&
		mapping.imageGenerations !== true &&
		mapping.videoGenerations !== true &&
		mapping.embeddings !== true &&
		mapping.speechGenerations !== true &&
		mapping.realtime !== true
	);
}

/** Whether a `web_search` tool works on this mapping, natively or not. */
export function supportsWebSearch(mapping: WebSearchMapping): boolean {
	return mapping.webSearch === true || usesGatewayWebSearch(mapping);
}

/**
 * Listed per-search price: the upstream's for native search, else the default
 * gateway engine's (an organization on another engine pays that engine's).
 */
export function webSearchListPrice(
	mapping: WebSearchMapping & Pick<ProviderModelMapping, "webSearchPrice">,
): string | undefined {
	if (mapping.webSearch === true) {
		return mapping.webSearchPrice?.toString();
	}
	return usesGatewayWebSearch(mapping)
		? GATEWAY_WEB_SEARCH_ENGINES[DEFAULT_GATEWAY_WEB_SEARCH_ENGINE].price
		: undefined;
}

/** The engine an organization's gateway-run searches use. */
export function resolveGatewayWebSearchEngine(
	orgSetting: string | null | undefined,
): GatewayWebSearchEngine {
	return isGatewayWebSearchEngine(orgSetting)
		? orgSetting
		: DEFAULT_GATEWAY_WEB_SEARCH_ENGINE;
}

export type WebSearchType = "native" | "gateway";

/**
 * Whether a logged request's web search ran on the gateway (`log.webSearchType`).
 * An engine id alone can't tell: a provider id can also be an engine id.
 */
export function isGatewayWebSearch(
	webSearchType: string | null | undefined,
): boolean {
	return webSearchType === "gateway";
}

/** One-line summary of who ran a logged request's web search. */
export function describeWebSearch(
	engine: string | null | undefined,
	webSearchType: string | null | undefined,
): string {
	if (!engine) {
		return "Web search was used in this request";
	}
	const name = formatWebSearchEngine(engine);
	return isGatewayWebSearch(webSearchType)
		? `Web search via ${name}, run by LLM Gateway`
		: `Native web search by ${name}`;
}

export function formatWebSearchEngine(engine: string): string {
	return engine in GATEWAY_WEB_SEARCH_ENGINES
		? GATEWAY_WEB_SEARCH_ENGINES[engine as GatewayWebSearchEngine].name
		: (getProviderDefinition(engine)?.name ?? engine);
}
