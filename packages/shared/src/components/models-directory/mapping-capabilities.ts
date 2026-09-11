import type { ApiModelProviderMapping } from "./api-types";

export const MAPPING_CAPABILITIES = [
	{ key: "streaming", label: "Streaming" },
	{ key: "vision", label: "Vision" },
	{ key: "audio", label: "Audio" },
	{ key: "document", label: "Documents" },
	{ key: "tools", label: "Tools" },
	{ key: "reasoning", label: "Reasoning" },
	{ key: "reasoningMaxTokens", label: "Reasoning budget" },
	{ key: "jsonOutput", label: "JSON output" },
	{ key: "jsonOutputSchema", label: "Structured JSON" },
	{ key: "webSearch", label: "Web search" },
	{ key: "realtime", label: "Realtime" },
	{ key: "rerank", label: "Reranking" },
] as const;

type MappingCapabilityKey = (typeof MAPPING_CAPABILITIES)[number]["key"];

export function getMappingCapabilities(
	mapping: Partial<Pick<ApiModelProviderMapping, MappingCapabilityKey>>,
) {
	return MAPPING_CAPABILITIES.filter(({ key }) => Boolean(mapping[key]));
}
