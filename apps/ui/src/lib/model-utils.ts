import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";

export function formatPrice(price: number | undefined): string {
	if (!price) {
		return "Free";
	}
	if (price < 0.000001) {
		return `$${(price * 1000000).toFixed(2)}/1M tokens`;
	}
	if (price < 0.001) {
		return `$${(price * 1000).toFixed(2)}/1K tokens`;
	}
	return `$${price.toFixed(4)}/token`;
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
	if (model.jsonOutput) {
		capabilities.push("JSON Output");
	}

	if (model.output?.includes("image")) {
		capabilities.push("Image Generation");
	}

	if (model.free) {
		capabilities.push("Free");
	}

	return capabilities;
}
