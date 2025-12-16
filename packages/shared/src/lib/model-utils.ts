import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";

export function formatPrice(price: number | undefined): string {
	// Unknown / missing pricing
	if (price === undefined) {
		return "Unknown";
	}

	// Explicitly free
	if (price === 0) {
		return "Free";
	}

	// All model prices in the catalog are stored as "per token" with values like 2 / 1e6.
	// For the playground we always want to show an explicit per‑million price (to match the /models UI),
	// otherwise small numbers like 2e‑6 end up rounded to $0.00/1K.
	const perMillion = price * 1_000_000;
	return `$${perMillion.toFixed(2)}/1M tokens`;
}

export function formatContextSize(size: number | undefined): string {
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
	model: ModelDefinition,
	providers: ProviderDefinition[],
): ProviderDefinition | undefined {
	const primaryProvider = model.providers[0];
	return providers.find((p) => p.id === primaryProvider?.providerId);
}

export function getModelCapabilities(model: ModelDefinition): string[] {
	const capabilities: string[] = [];
	const provider = model.providers[0];

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
