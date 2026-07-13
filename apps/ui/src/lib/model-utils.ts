import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";

export function formatPrice(price: number | string | undefined): string {
	if (price === undefined || price === null) {
		return "Free";
	}
	const n = typeof price === "string" ? Number(price) : price;
	if (!Number.isFinite(n)) {
		return "Unknown";
	}
	if (n === 0) {
		return "Free";
	}
	if (n < 0.000001) {
		return `$${(n * 1000000).toFixed(2)}/1M tokens`;
	}
	if (n < 0.001) {
		return `$${(n * 1000).toFixed(2)}/1K tokens`;
	}
	return `$${n.toFixed(4)}/token`;
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

	if (model.output?.includes("image")) {
		capabilities.push("Image Generation");
	}

	// Only show "Free" if model has free flag AND no per-request pricing
	const hasRequestPrice = model.providers.some(
		(p) => p.requestPrice && Number(p.requestPrice) > 0,
	);
	if (model.free && !hasRequestPrice) {
		capabilities.push("Free");
	}

	return capabilities;
}
