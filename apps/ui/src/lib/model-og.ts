import { models } from "@llmgateway/models";

export function getModelOgImageUrl(
	modelId: string,
	providerId: string,
): string {
	const hasStaticMapping = models
		.find((model) => model.id === modelId)
		?.providers.some((mapping) => mapping.providerId === providerId);

	return hasStaticMapping
		? `/models/${encodeURIComponent(modelId)}/${encodeURIComponent(providerId)}/opengraph-image`
		: "/opengraph.png";
}
