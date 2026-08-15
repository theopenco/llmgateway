import { isCodingModel } from "@/coding-models.js";

import { matchesCapability } from "./capability-filters";
import { applyCategoryFilter } from "./model-category-filters";

import type { ApiModel, ApiModelProviderMapping } from "./api-types";
import type { ModelCategoryFilter } from "./model-category-filters";

export type UseCaseCategory =
	"all" | "code" | "chat" | "reasoning" | "creative" | "image" | "multimodal";

export const useCaseCategories: readonly UseCaseCategory[] = [
	"all",
	"code",
	"chat",
	"reasoning",
	"creative",
	"image",
	"multimodal",
];

export function isUseCaseCategory(
	value: string | null,
): value is UseCaseCategory {
	return (
		value !== null && (useCaseCategories as readonly string[]).includes(value)
	);
}

export function applyUseCaseFilter(
	category: string,
	model: ApiModel,
	mappings: ApiModelProviderMapping[],
): boolean {
	switch (category) {
		case "all":
			return true;
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
			// Image Generation. Image capability is model-level: every mapping
			// of an image-output model serves image, and the API exposes no
			// mapping-level image-capability flag (perImagePrice is a pricing
			// field that per-token-billed image models like gpt-image-2 and
			// Gemini's image models do not carry), so this cannot differ per row.
			return model.output?.includes("image") === true;
		case "multimodal":
			// Multimodal: vision capability
			return mappings.some((p) => p.vision);
		default:
			return true;
	}
}

export interface ProviderRowFilterOptions {
	providerFilter: string | null;
	capabilities: {
		streaming: boolean;
		vision: boolean;
		tools: boolean;
		reasoning: boolean;
		reasoningBudget: boolean;
		jsonOutput: boolean;
		jsonOutputSchema: boolean;
		webSearch: boolean;
		discounted: boolean;
	};
	categoryFilter?: ModelCategoryFilter;
	category?: string;
}

// Single source of truth for which provider rows belong in the filtered table.
// The flatten loop in all-models.tsx calls this for every mapping, so the
// directory's per-row filtering is the same code the tests exercise.
export function providerRowPassesFilters(
	model: ApiModel,
	provider: ApiModelProviderMapping,
	options: ProviderRowFilterOptions,
): boolean {
	const { providerFilter, capabilities, categoryFilter, category } = options;

	if (providerFilter && provider.providerId !== providerFilter) {
		return false;
	}

	if (
		(capabilities.streaming && !matchesCapability("streaming", provider)) ||
		(capabilities.vision && !matchesCapability("vision", provider)) ||
		(capabilities.tools && !matchesCapability("tools", provider)) ||
		(capabilities.reasoning && !matchesCapability("reasoning", provider)) ||
		(capabilities.reasoningBudget &&
			!matchesCapability("reasoningMaxTokens", provider)) ||
		(capabilities.jsonOutput && !matchesCapability("jsonOutput", provider)) ||
		(capabilities.jsonOutputSchema &&
			!matchesCapability("jsonOutputSchema", provider)) ||
		(capabilities.webSearch && !matchesCapability("webSearch", provider)) ||
		(capabilities.discounted && !matchesCapability("discounted", provider))
	) {
		return false;
	}

	if (
		categoryFilter &&
		!applyCategoryFilter(categoryFilter, model, [provider])
	) {
		return false;
	}

	if (
		category &&
		category !== "all" &&
		!applyUseCaseFilter(category, model, [provider])
	) {
		return false;
	}

	return true;
}
