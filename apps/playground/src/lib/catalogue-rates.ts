import { isLiveMapping, models } from "@llmgateway/models";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

type RateReader = (
	mapping: ProviderModelMapping,
) => string | number | undefined;

function toNumber(value: string | number | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The lowest live catalogue rate for a model, read with `read` from each of its
 * provider mappings. Returns null when no live mapping carries the rate, so a
 * retired mapping drops its row instead of showing a stale price.
 */
export function liveRate(modelId: string, read: RateReader): number | null {
	const model = (models as readonly ModelDefinition[]).find(
		(entry) => entry.id === modelId,
	);
	if (!model) {
		return null;
	}
	const rates = model.providers
		.filter((mapping) => isLiveMapping(mapping))
		.map((mapping) => toNumber(read(mapping)))
		.filter((rate): rate is number => rate !== undefined);
	return rates.length > 0 ? Math.min(...rates) : null;
}

export const perSecond =
	(key: string): RateReader =>
	(mapping) =>
		mapping.perSecondPrice?.[key];

export const perCharacter: RateReader = (mapping) =>
	mapping.inputCharacterPrice;

export const perInputToken: RateReader = (mapping) => mapping.inputPrice;

export const perOutputToken: RateReader = (mapping) => mapping.outputPrice;

export const perImage =
	(key: string): RateReader =>
	(mapping) =>
		mapping.perImagePrice?.[key];

/** Token-priced image models: output-image rate × tokens at a resolution. */
export const imageAtResolution =
	(resolution: string): RateReader =>
	(mapping) => {
		const rate = toNumber(mapping.imageOutputPrice);
		const tokens = mapping.imageOutputTokensByResolution?.[resolution];
		return rate === undefined || tokens === undefined
			? undefined
			: rate * tokens;
	};

export const perInputAudioToken: RateReader = (mapping) =>
	mapping.inputAudioPrice;

export const perOutputAudioToken: RateReader = (mapping) =>
	mapping.outputAudioPrice;

type StudioCapability = "video" | "image" | "audio" | "calls" | "decisions";

const capabilityTests: Record<
	StudioCapability,
	(mapping: ProviderModelMapping, output: readonly string[]) => boolean
> = {
	video: (mapping) => mapping.videoGenerations === true,
	image: (mapping) => mapping.imageGenerations === true,
	audio: (mapping) => mapping.speechGenerations === true,
	calls: (mapping) => mapping.realtime === true,
	decisions: (mapping, output) =>
		mapping.decisions === true || output.includes("decision"),
};

/** How many catalogue models a studio can run today. */
export function studioModelCount(capability: StudioCapability): number {
	const test = capabilityTests[capability];
	return (models as readonly ModelDefinition[]).filter((model) =>
		model.providers.some(
			(mapping) => isLiveMapping(mapping) && test(mapping, model.output ?? []),
		),
	).length;
}
