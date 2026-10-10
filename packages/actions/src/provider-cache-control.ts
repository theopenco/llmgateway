import {
	supportsOpenAIExplicitPromptCache,
	type ProviderApiFormat,
} from "@llmgateway/models";

import { usesAnthropicMessagesApi } from "./anthropic-tool-search.js";
import { getProviderApiTransport } from "./provider-api-format.js";

export const DEFAULT_MIN_CACHEABLE_TOKENS = 1024;

export interface CacheTarget {
	providerId: string;
	modelId: string;
	apiFormat: ProviderApiFormat | null;
}

export function autoModeEnablesCaching({
	providerId,
	modelId,
	apiFormat,
}: CacheTarget): boolean {
	const transport = getProviderApiTransport(providerId, apiFormat ?? undefined);
	if (usesAnthropicMessagesApi(transport) || transport === "aws-bedrock") {
		return true;
	}
	return transport === "openai" && supportsOpenAIExplicitPromptCache(modelId);
}
