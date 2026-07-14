import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
	ReasoningEffortOption,
} from "@/lib/fetch-models";

export const REASONING_EFFORT_ORDER: ReasoningEffortOption[] = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/**
 * Generic effort options for models that don't declare their supported
 * values in the catalog yet. Used for both rendering the selector and
 * resetting a stale selection, so the two never disagree.
 */
export function getFallbackReasoningEffortOptions(
	selectedModel: string,
): ReasoningEffortOption[] {
	return selectedModel.includes("gpt-5")
		? ["minimal", "low", "medium", "high"]
		: ["low", "medium", "high"];
}

/**
 * Union of the reasoning_effort values declared by the given provider
 * mappings, in ascending order of effort. Returns null when none of the
 * mappings declare their supported values, so callers can fall back to a
 * generic default set.
 */
export function getReasoningEffortOptions(
	mappings: ApiModelProviderMapping[],
): ReasoningEffortOption[] | null {
	const declared = mappings.filter(
		(m) => m.reasoningEfforts && m.reasoningEfforts.length > 0,
	);
	if (declared.length === 0) {
		return null;
	}
	return REASONING_EFFORT_ORDER.filter((effort) =>
		declared.some((m) => m.reasoningEfforts!.includes(effort)),
	);
}

export function formatPrice(price: number | string | undefined): string {
	// Unknown / missing pricing
	if (price === undefined) {
		return "Unknown";
	}

	const n = typeof price === "string" ? Number(price) : price;
	if (!Number.isFinite(n)) {
		return "Unknown";
	}

	// Explicitly free
	if (n === 0) {
		return "Free";
	}

	// All model prices in the catalog are stored as "per token" with values like 2 / 1e6.
	// For the playground we always want to show an explicit per‑million price (to match the /models UI),
	// otherwise small numbers like 2e‑6 end up rounded to $0.00/1K.
	const perMillion = n * 1_000_000;
	// Show full precision (up to 4 decimals) without trailing zeros
	const formatted = parseFloat(perMillion.toFixed(4)).toString();
	return `$${formatted}/1M tokens`;
}

export function formatContextSize(size: number | null | undefined): string {
	if (!size) {
		return "Unknown";
	}
	if (size >= 1000000) {
		return `${(size / 1000000).toFixed(1)}M tokens`;
	}
	if (size >= 1000) {
		return `${(size / 1000).toFixed(0)}K tokens`;
	}
	return `${size} tokens`;
}

export function getProviderForModel(
	model: ApiModel,
	providers: ApiProvider[],
): ApiProvider | undefined {
	const primaryProvider = model.mappings[0];
	return providers.find((p) => p.id === primaryProvider?.providerId);
}

export function getModelCapabilities(model: ApiModel): string[] {
	const capabilities: string[] = [];
	const provider = model.mappings[0];

	if (provider?.streaming) {
		capabilities.push("Streaming");
	}
	if (provider?.vision) {
		capabilities.push("Vision");
	}
	if (provider?.tools) {
		capabilities.push("Tools");
	}
	if (provider?.reasoning) {
		capabilities.push("Reasoning");
	}
	if (provider?.jsonOutput) {
		capabilities.push("JSON Output");
	}

	return capabilities;
}
