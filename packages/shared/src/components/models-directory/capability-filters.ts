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
