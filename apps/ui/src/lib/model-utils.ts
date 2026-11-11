import { isMappingDeactivated } from "@llmgateway/shared/deactivation";
import { formatCompactNumber } from "@llmgateway/shared/number-format";

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
	return size ? `${formatCompactNumber(size)} tokens` : "Unknown";
}

export function getProviderForModel(
	model: ModelDefinition,
	providers: ProviderDefinition[],
): ProviderDefinition | undefined {
	const primaryProvider = model.providers[0];
	return providers.find((p) => p.id === primaryProvider?.providerId);
}

export function getLoungeStudioPath(
	output: readonly string[] | null | undefined,
): string {
	if (output?.includes("video")) {
		return "/video";
	}
	if (output?.includes("image")) {
		return "/image";
	}
	if (output?.includes("audio")) {
		return "/audio";
	}
	return "";
}

interface LoungeMapping {
	providerId: string;
	deactivatedAt?: Date | string | null;
	streaming?: boolean | "only" | null;
	realtime?: boolean | null;
	realtimeTranscription?: boolean | null;
}

/**
 * Whether a new Lounge account can chat with the model through `routes`, the
 * mappings a page offers. Lounge chat streams text and routes the bare model
 * id, so every live mapping has to stream.
 */
export function isLoungeChatModel(
	model: {
		id: string;
		output?: readonly string[] | null;
		enterpriseOnly?: boolean;
		providers: readonly LoungeMapping[];
	},
	routes: readonly LoungeMapping[],
): boolean {
	if (model.enterpriseOnly || model.output?.some((kind) => kind !== "text")) {
		return false;
	}
	// Smart Route needs an organization config and Custom a base URL.
	if (
		model.id !== "auto" &&
		model.providers.some((mapping) => mapping.providerId === "llmgateway")
	) {
		return false;
	}
	if (
		model.providers.some(
			(mapping) =>
				mapping.realtime ||
				mapping.realtimeTranscription ||
				(mapping.streaming === false && !isMappingDeactivated(mapping)),
		)
	) {
		return false;
	}
	return routes.some((mapping) => !isMappingDeactivated(mapping));
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
