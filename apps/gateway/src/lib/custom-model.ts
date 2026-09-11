import type { CustomModel } from "@/lib/cached-queries.js";
import type { ProviderModelMapping } from "@llmgateway/models";

/** Shared custom-model pricing and capabilities for routing and discovery. */
export function customModelToProviderMapping(
	cm: CustomModel,
): ProviderModelMapping {
	const streaming: boolean | "only" =
		cm.streaming === "only" ? "only" : cm.streaming !== "false";
	return {
		providerId: "custom",
		externalId: cm.modelName,
		inputPrice: cm.inputPrice ?? undefined,
		outputPrice: cm.outputPrice ?? undefined,
		cachedInputPrice: cm.cachedInputPrice ?? undefined,
		cacheReadInputPrice: cm.cacheReadInputPrice ?? undefined,
		cacheWriteInputPrice: cm.cacheWriteInputPrice ?? undefined,
		cacheWriteInputPrice1h: cm.cacheWriteInputPrice1h ?? undefined,
		requestPrice: cm.requestPrice ?? undefined,
		webSearchPrice: cm.webSearchPrice ?? undefined,
		imageInputPrice: cm.imageInputPrice ?? undefined,
		inputAudioPrice: cm.audioInputPrice ?? undefined,
		contextSize: cm.contextSize ?? undefined,
		maxOutput: cm.maxOutput ?? undefined,
		vision: cm.vision ?? undefined,
		tools: cm.tools ?? undefined,
		reasoning: cm.reasoning ?? undefined,
		jsonOutput: cm.jsonOutput ?? undefined,
		jsonOutputSchema: cm.jsonOutput ?? undefined,
		audio: cm.audio ?? undefined,
		supportedParameters: cm.supportedParameters ?? undefined,
		streaming,
	};
}
