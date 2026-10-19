import { discountFraction } from "@/lib/discount";

import type { ApiModelProviderMapping } from "./api-types";

export type CapabilityFilter =
	| "streaming"
	| "vision"
	| "tools"
	| "reasoning"
	| "reasoningMaxTokens"
	| "jsonOutput"
	| "jsonOutputSchema"
	| "webSearch"
	| "discounted";

export const OUTPUT_KIND_BY_CAPABILITY_FILTER = {
	imageGeneration: "image",
	videoGeneration: "video",
	audioGeneration: "audio",
	transcription: "transcription",
	embedding: "embedding",
	rerank: "rerank",
	decisions: "decision",
	searchApi: "search",
} as const;

export type OutputCapabilityFilter =
	keyof typeof OUTPUT_KIND_BY_CAPABILITY_FILTER;

export function matchesOutputCapabilities(
	enabled: Partial<Record<OutputCapabilityFilter, boolean>>,
	output: readonly string[] | null | undefined,
): boolean {
	return (
		Object.entries(OUTPUT_KIND_BY_CAPABILITY_FILTER) as [
			OutputCapabilityFilter,
			string,
		][]
	).every(([filter, kind]) => !enabled[filter] || !!output?.includes(kind));
}

export function matchesCapability(
	capability: CapabilityFilter,
	provider: ApiModelProviderMapping,
): boolean {
	switch (capability) {
		case "streaming":
			return provider.streaming === true;
		case "vision":
			return provider.vision === true;
		case "tools":
			return provider.tools === true;
		case "reasoning":
			return provider.reasoning === true;
		case "reasoningMaxTokens":
			return provider.reasoningMaxTokens === true;
		case "jsonOutput":
			return provider.jsonOutput === true;
		case "jsonOutputSchema":
			return provider.jsonOutputSchema === true;
		case "webSearch":
			return provider.webSearch === true;
		case "discounted":
			return discountFraction(provider.discount) > 0;
	}
}
