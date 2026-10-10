import {
	expandAllProviderRegions,
	models,
	type ProviderModelMapping,
} from "@llmgateway/models";

import type { BenchmarkTarget, BenchmarkTargetSource } from "./types.js";

export interface ResolveBenchmarkTargetsOptions {
	modelIds: string[];
	mappings?: string[];
	includeDeactivated?: boolean;
	now?: Date;
}

/**
 * One benchmarkable provider mapping, flattened away from its source. The
 * static catalogue and `model_provider_mapping` rows both reduce to this, so
 * an Airside listing that exists only in the database is benchmarkable on
 * exactly the same path as a catalogue entry.
 */
export interface BenchmarkMappingDescriptor {
	modelId: string;
	modelName: string;
	providerId: string;
	region?: string | null;
	externalId: string;
	deactivatedAt?: Date | null;
	quantization?: string | null;
	stability?: string | null;
	inputPrice?: string | null;
	outputPrice?: string | null;
	requestPrice?: string | null;
	contextSize?: number | null;
	maxOutput?: number | null;
	source?: BenchmarkTargetSource;
}

export interface BuildBenchmarkTargetsOptions {
	descriptors: BenchmarkMappingDescriptor[];
	mappings?: string[];
	includeDeactivated?: boolean;
	now?: Date;
}

function descriptorLabel(descriptor: BenchmarkMappingDescriptor): string {
	return descriptor.region
		? `${descriptor.providerId}:${descriptor.region}`
		: descriptor.providerId;
}

function selectorMatches(
	selector: string,
	descriptor: BenchmarkMappingDescriptor,
): boolean {
	if (selector === "*") {
		return true;
	}
	if (selector.endsWith(":*")) {
		return (
			descriptor.providerId === selector.slice(0, -2) &&
			Boolean(descriptor.region)
		);
	}
	return descriptorLabel(descriptor) === selector;
}

function isActive(descriptor: BenchmarkMappingDescriptor, now: Date): boolean {
	return !descriptor.deactivatedAt || descriptor.deactivatedAt > now;
}

export function catalogueMappingDescriptors(
	modelId: string,
): BenchmarkMappingDescriptor[] {
	const model = models.find((candidate) => candidate.id === modelId);
	if (!model) {
		throw new Error(`Unknown model: ${modelId}`);
	}
	return expandAllProviderRegions(
		model.providers as ProviderModelMapping[],
	).map((mapping) => ({
		modelId,
		modelName: model.name,
		providerId: mapping.providerId,
		region: mapping.region ?? null,
		externalId: mapping.externalId,
		deactivatedAt: mapping.deactivatedAt ?? null,
		quantization: mapping.quantization ?? null,
		stability: mapping.stability ?? null,
		inputPrice: mapping.inputPrice ?? null,
		outputPrice: mapping.outputPrice ?? null,
		requestPrice: mapping.requestPrice ?? "0",
		contextSize: mapping.contextSize ?? null,
		maxOutput: mapping.maxOutput ?? null,
		source: "catalogue",
	}));
}

export function buildBenchmarkTargets({
	descriptors,
	mappings,
	includeDeactivated = false,
	now = new Date(),
}: BuildBenchmarkTargetsOptions): BenchmarkTarget[] {
	const normalizedSelectors = mappings?.map((selector) => selector.trim());
	const matchedSelectors = new Set<string>();
	const targets: BenchmarkTarget[] = [];

	for (const descriptor of descriptors) {
		if (!includeDeactivated && !isActive(descriptor, now)) {
			continue;
		}
		if (normalizedSelectors) {
			const matches = normalizedSelectors.filter((selector) =>
				selectorMatches(selector, descriptor),
			);
			if (matches.length === 0) {
				continue;
			}
			for (const selector of matches) {
				matchedSelectors.add(selector);
			}
		}
		const mappingId = descriptorLabel(descriptor);
		const pinnedModel = `${descriptor.providerId}/${descriptor.modelId}${
			descriptor.region ? `:${descriptor.region}` : ""
		}`;
		targets.push({
			id: pinnedModel,
			model: pinnedModel,
			modelId: descriptor.modelId,
			mapping: mappingId,
			displayName: `${descriptor.modelName} via ${mappingId}`,
			metadata: {
				provider: descriptor.providerId,
				region: descriptor.region ?? null,
				externalId: descriptor.externalId,
				quantization: descriptor.quantization ?? null,
				stability: descriptor.stability ?? null,
				inputPrice: descriptor.inputPrice ?? null,
				outputPrice: descriptor.outputPrice ?? null,
				requestPrice: descriptor.requestPrice ?? "0",
				contextSize: descriptor.contextSize ?? null,
				maxOutput: descriptor.maxOutput ?? null,
				source: descriptor.source ?? "catalogue",
			},
		});
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

export function resolveBenchmarkTargets({
	modelIds,
	mappings,
	includeDeactivated,
	now,
}: ResolveBenchmarkTargetsOptions): BenchmarkTarget[] {
	if (modelIds.length === 0) {
		throw new Error("At least one model is required");
	}
	return buildBenchmarkTargets({
		descriptors: modelIds.flatMap((modelId) =>
			catalogueMappingDescriptors(modelId),
		),
		mappings,
		includeDeactivated,
		now,
	});
}
