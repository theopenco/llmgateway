import {
	getDataPolicyComplianceFailures,
	getProviderComplianceFailures,
	getProviderDefinition,
	getProviderRefPolicyListFailures,
	type ComplianceFailureReason,
	type ProviderCompliancePolicy,
	type ProviderDataPolicy,
	type ProviderDefinition,
} from "./providers.js";

import type { ProviderModelMapping } from "./models.js";

/** Who receives a gateway-run search query, for compliance checks and disclosure. */
export type WebSearchEngineProcessor =
	/** A catalogue provider: its catalogue entry is the engine's data policy. */
	| { providerId: string }
	| {
			legalEntity: string;
			headquarters: string;
			privacyPolicyUrl: string;
			dataPolicy: ProviderDataPolicy;
	  };

/**
 * Search engines the gateway runs itself for chat mappings without native web
 * search (`usesGatewayWebSearch`). An organization picks one
 * (`organization.webSearchEngine`), else the default. `price` is billed per
 * search, in USD. `processor` is checked against compliance policies like a
 * provider: the engine receives the caller's latest user message.
 */
export const GATEWAY_WEB_SEARCH_ENGINES = {
	perplexity: {
		name: "Perplexity",
		price: "0.005",
		processor: { providerId: "perplexity" },
	},
	exa: {
		name: "Exa",
		price: "0.007",
		processor: {
			legalEntity: "Exa Labs Inc.",
			headquarters: "US",
			privacyPolicyUrl: "https://exa.ai/privacy-policy",
			// Query data trains Exa's models; ZDR needs an Exa Enterprise plan.
			dataPolicy: {
				apiTraining: true,
				promptLogging: true,
				retentionPeriod: null,
				soc2: 2,
				gdpr: true,
			},
		},
	},
} as const satisfies Record<
	string,
	{ name: string; price: string; processor: WebSearchEngineProcessor }
>;

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

/**
 * Mapping flags of every non-chat endpoint. None of these mappings take a
 * `web_search` tool, natively or gateway-run.
 */
const NON_CHAT_MAPPING_FLAGS = [
	"imageGenerations",
	"videoGenerations",
	"musicGenerations",
	"embeddings",
	"speechGenerations",
	"transcriptions",
	"realtime",
	"realtimeTranscription",
	"ocr",
	"rerank",
	"decisions",
	"search",
] as const satisfies ReadonlyArray<keyof ProviderModelMapping>;

type WebSearchMapping = Pick<
	ProviderModelMapping,
	"webSearch" | (typeof NON_CHAT_MAPPING_FLAGS)[number]
>;

/** Whether the mapping serves chat completions. */
function isChatMapping(mapping: WebSearchMapping): boolean {
	return NON_CHAT_MAPPING_FLAGS.every((flag) => mapping[flag] !== true);
}

/**
 * Whether the gateway runs web search for this mapping: a chat mapping whose
 * upstream has no native search. The model calls a `web_search` function and
 * the gateway runs the searches (`runWebSearchLoop`).
 */
export function usesGatewayWebSearch(mapping: WebSearchMapping): boolean {
	return mapping.webSearch !== true && isChatMapping(mapping);
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

/**
 * Data policy and headquarters of the party receiving an engine's queries.
 * `providers` overrides catalogue entries, as the gateway's effective
 * providers do.
 */
export function getWebSearchEngineDataPolicy(
	engine: GatewayWebSearchEngine,
	providers?: readonly ProviderDefinition[],
): { dataPolicy: ProviderDataPolicy | null; headquarters: string | null } {
	const processor: WebSearchEngineProcessor =
		GATEWAY_WEB_SEARCH_ENGINES[engine].processor;
	if ("providerId" in processor) {
		const provider = resolveEngineProvider(processor.providerId, providers);
		return {
			dataPolicy: provider?.dataPolicy ?? null,
			headquarters: provider?.headquarters ?? null,
		};
	}
	return {
		dataPolicy: processor.dataPolicy,
		headquarters: processor.headquarters,
	};
}

function resolveEngineProvider(
	providerId: string,
	providers?: readonly ProviderDefinition[],
): ProviderDefinition | undefined {
	return (
		providers?.find((provider) => provider.id === providerId) ??
		getProviderDefinition(providerId)
	);
}

/**
 * Every requirement of one compliance policy the engine fails, with the same
 * fail-closed rules as providers. An engine run by a catalogue provider is
 * that provider (its lists and data policy apply); any other engine is listed
 * in provider lists by its engine id.
 */
export function getWebSearchEngineComplianceFailures(
	engine: GatewayWebSearchEngine,
	policy: ProviderCompliancePolicy,
	providers?: readonly ProviderDefinition[],
): ComplianceFailureReason[] {
	if (!policy.enabled) {
		return [];
	}
	const processor: WebSearchEngineProcessor =
		GATEWAY_WEB_SEARCH_ENGINES[engine].processor;
	if ("providerId" in processor) {
		const provider = resolveEngineProvider(processor.providerId, providers);
		return provider
			? getProviderComplianceFailures(provider, policy)
			: ["unknownProvider"];
	}
	return [
		...getProviderRefPolicyListFailures(engine, policy),
		...getDataPolicyComplianceFailures(
			processor.dataPolicy,
			processor.headquarters,
			policy,
		),
	];
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
