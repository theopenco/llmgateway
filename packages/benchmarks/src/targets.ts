import {
	expandAllProviderRegions,
	models,
	type ProviderModelMapping,
} from "@llmgateway/models";

import type { BenchmarkTarget } from "./types.js";

export interface ResolveBenchmarkTargetsOptions {
	modelIds: string[];
	mappings?: string[];
	includeDeactivated?: boolean;
	now?: Date;
}

function mappingLabel(mapping: ProviderModelMapping): string {
	return mapping.region
		? `${mapping.providerId}:${mapping.region}`
		: mapping.providerId;
}

function selectorMatches(
	selector: string,
	mapping: ProviderModelMapping,
): boolean {
	if (selector === "*") {
		return true;
	}
	if (selector.endsWith(":*")) {
		return (
			mapping.providerId === selector.slice(0, -2) &&
			mapping.region !== undefined
		);
	}
	return mappingLabel(mapping) === selector;
}

function isActive(mapping: ProviderModelMapping, now: Date): boolean {
	return !mapping.deactivatedAt || mapping.deactivatedAt > now;
}

export function resolveBenchmarkTargets({
	modelIds,
	mappings,
	includeDeactivated = false,
	now = new Date(),
}: ResolveBenchmarkTargetsOptions): BenchmarkTarget[] {
	if (modelIds.length === 0) {
		throw new Error("At least one model is required");
	}
	const normalizedSelectors = mappings?.map((selector) => selector.trim());
	const matchedSelectors = new Set<string>();
	const targets: BenchmarkTarget[] = [];

	for (const modelId of modelIds) {
		const model = models.find((candidate) => candidate.id === modelId);
		if (!model) {
			throw new Error(`Unknown model: ${modelId}`);
		}
		const expanded = expandAllProviderRegions(
			model.providers as ProviderModelMapping[],
		).filter((mapping) => includeDeactivated || isActive(mapping, now));
		for (const mapping of expanded) {
			if (normalizedSelectors) {
				const matches = normalizedSelectors.filter((selector) =>
					selectorMatches(selector, mapping),
				);
				if (matches.length === 0) {
					continue;
				}
				for (const selector of matches) {
					matchedSelectors.add(selector);
				}
			}
			const mappingId = mappingLabel(mapping);
			const pinnedModel = `${mapping.providerId}/${modelId}${mapping.region ? `:${mapping.region}` : ""}`;
			targets.push({
				id: pinnedModel,
				model: pinnedModel,
				modelId,
				mapping: mappingId,
				displayName: `${model.name} via ${mappingId}`,
				metadata: {
					provider: mapping.providerId,
					region: mapping.region ?? null,
					externalId: mapping.externalId,
					quantization: mapping.quantization ?? null,
					stability: mapping.stability ?? null,
					inputPrice: mapping.inputPrice ?? null,
					outputPrice: mapping.outputPrice ?? null,
					requestPrice: mapping.requestPrice ?? "0",
					contextSize: mapping.contextSize ?? null,
					maxOutput: mapping.maxOutput ?? null,
				},
			});
		}
	}

	const unmatched = normalizedSelectors?.filter(
		(selector) => !matchedSelectors.has(selector),
	);
	if (unmatched && unmatched.length > 0) {
		throw new Error(
			`No selected model has mapping(s): ${unmatched.join(", ")}`,
		);
	}
	if (targets.length === 0) {
		throw new Error("No benchmark targets matched");
	}
	return targets;
}
