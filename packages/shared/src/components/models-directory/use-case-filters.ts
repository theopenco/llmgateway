import { isCodingModel } from "@/coding-models.js";

import type { ApiModel, ApiModelProviderMapping } from "./api-types";

export type UseCaseCategory =
	"code" | "chat" | "reasoning" | "creative" | "image" | "multimodal";

export function applyUseCaseFilter(
	category: string,
	model: ApiModel,
	mappings: ApiModelProviderMapping[],
): boolean {
	switch (category) {
		case "code":
			// Exactly the predicate the gateway enforces for DevPass coding
			// plans, so this list can never claim less than the plan serves.
			return isCodingModel({
				free: model.free,
				stability: model.stability,
				providers: mappings,
			});
		case "chat":
			// Chat & Assistants: general chat models with streaming and cached input pricing
			return mappings.some((p) => p.streaming && p.cachedInputPrice !== null);
		case "reasoning":
			// Reasoning & Analysis: models with reasoning capability
			return mappings.some((p) => p.reasoning);
		case "creative":
			// Creative & Writing: exclude image generation models
			if (model.output?.includes("image")) {
				return false;
			}
			return mappings.some((p) => p.streaming);
		case "image":
			// Image Generation
			return model.output?.includes("image") === true;
		case "multimodal":
			// Multimodal: vision capability
			return mappings.some((p) => p.vision);
		default:
			return true;
	}
}
