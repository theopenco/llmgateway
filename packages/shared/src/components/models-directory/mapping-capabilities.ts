import type { ApiModelProviderMapping } from "./api-types";

export const BATCH_DOCS_URL = "https://docs.llmgateway.io/features/batch";

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
	{ key: "batchEndpoints", label: "Batch" },
] as const;

type MappingCapabilityKey = (typeof MAPPING_CAPABILITIES)[number]["key"];

export function hasBatchSupport(
	mapping: Partial<Pick<ApiModelProviderMapping, "batchEndpoints">>,
): boolean {
	return (mapping.batchEndpoints?.length ?? 0) > 0;
}

export function batchSupportDescription(
	endpoints: readonly string[] | null | undefined,
): string {
	return `Available through the Batch API (${(endpoints ?? []).join(", ")}). Billed at the same per-token price as live requests, priced when each request runs. No batch discount and no storage fee; provider-native batch discounts are not passed through.`;
}

export function getMappingCapabilities(
	mapping: Partial<Pick<ApiModelProviderMapping, MappingCapabilityKey>>,
) {
	return MAPPING_CAPABILITIES.filter(({ key }) =>
		key === "batchEndpoints" ? hasBatchSupport(mapping) : Boolean(mapping[key]),
	);
}
