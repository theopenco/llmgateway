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

/** A provider mapping as published by the gateway's `GET /v1/models`. */
export interface GatewayModelsProviderMapping {
	providerId: string;
	externalId: string;
	deactivated_at?: string | null;
	quantization?: string | null;
	stability?: string | null;
	pricing?: { prompt?: string; completion?: string; request?: string };
	context_length?: number | null;
	max_output?: number | null;
	regions?: Array<{
		id: string;
		pricing?: { prompt?: string; completion?: string; request?: string };
		context_length?: number | null;
		max_output?: number | null;
	}>;
}

export interface GatewayModelsEntry {
	id: string;
	name?: string;
	providers?: GatewayModelsProviderMapping[];
}

/**
 * Descriptors for one model from the gateway's live catalogue, which merges
 * Airside listings into the static one. A pair absent from the static
 * catalogue is an Airside listing.
 */
export function gatewayMappingDescriptors(
	model: GatewayModelsEntry,
): BenchmarkMappingDescriptor[] {
	const staticModel = models.find((candidate) => candidate.id === model.id);
	return (model.providers ?? []).flatMap((mapping) => {
		const base: BenchmarkMappingDescriptor = {
			modelId: model.id,
			modelName: model.name ?? model.id,
			providerId: mapping.providerId,
			region: null,
			externalId: mapping.externalId,
			deactivatedAt: mapping.deactivated_at
				? new Date(mapping.deactivated_at)
				: null,
			quantization: mapping.quantization ?? null,
			stability: mapping.stability ?? null,
			inputPrice: mapping.pricing?.prompt ?? null,
			outputPrice: mapping.pricing?.completion ?? null,
			requestPrice: mapping.pricing?.request ?? "0",
			contextSize: mapping.context_length ?? null,
			maxOutput: mapping.max_output ?? null,
			source: staticModel?.providers.some(
				(candidate) => candidate.providerId === mapping.providerId,
			)
				? "catalogue"
				: "airside",
		};
		return [
			base,
			...(mapping.regions ?? []).map((region) => ({
				...base,
				region: region.id,
				inputPrice: region.pricing?.prompt ?? base.inputPrice,
				outputPrice: region.pricing?.completion ?? base.outputPrice,
				requestPrice: region.pricing?.request ?? base.requestPrice,
				contextSize: region.context_length ?? base.contextSize,
				maxOutput: region.max_output ?? base.maxOutput,
			})),
		];
	});
}

/** The `/v1/models` URL served next to a chat-completions endpoint. */
export function gatewayModelsUrl(chatCompletionsUrl: string): string {
	const url = new URL(chatCompletionsUrl);
	url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, "/models");
	url.search = "";
	url.searchParams.set("include_deactivated", "true");
	return url.toString();
}

export interface FetchGatewayMappingDescriptorsOptions {
	modelIds: string[];
	modelsUrl: string;
	fetch?: typeof fetch;
}

/** Load descriptors from the gateway, so Airside listings are benchmarkable. */
export async function fetchGatewayMappingDescriptors({
	modelIds,
	modelsUrl,
	fetch: fetchImplementation = fetch,
}: FetchGatewayMappingDescriptorsOptions): Promise<
	BenchmarkMappingDescriptor[]
> {
	if (modelIds.length === 0) {
		throw new Error("At least one model is required");
	}
	const response = await fetchImplementation(modelsUrl);
	if (!response.ok) {
		throw new Error(`GET ${modelsUrl} failed with HTTP ${response.status}`);
	}
	const body = (await response.json()) as { data?: GatewayModelsEntry[] };
	return modelIds.flatMap((modelId) => {
		const model = body.data?.find((candidate) => candidate.id === modelId);
		if (!model) {
			throw new Error(`Unknown model: ${modelId}`);
		}
		return gatewayMappingDescriptors(model);
	});
}
