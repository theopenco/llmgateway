import { Decimal } from "decimal.js";

import type { ProviderModelMapping } from "@llmgateway/models";

/**
 * Modality-level token counts extracted from an OpenAI Realtime
 * `response.done` usage block. All values are non-negative integers and the
 * modality details are cross-checked against the reported totals, so a usage
 * block containing an unknown or inconsistent dimension fails normalization
 * instead of being silently underbilled.
 */
export interface NormalizedRealtimeUsage {
	totalTokens: number;
	inputTokens: number;
	outputTokens: number;
	inputTextTokens: number;
	inputAudioTokens: number;
	inputImageTokens: number;
	cachedTokens: number;
	cachedTextTokens: number;
	cachedAudioTokens: number;
	cachedImageTokens: number;
	outputTextTokens: number;
	outputAudioTokens: number;
}

export type NormalizeRealtimeUsageResult =
	{ ok: true; usage: NormalizedRealtimeUsage } | { ok: false; reason: string };

function readCount(value: unknown): number | null {
	if (value === undefined || value === null) {
		return 0;
	}
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		!Number.isInteger(value) ||
		value < 0
	) {
		return null;
	}
	return value;
}

function asObject(value: unknown): Record<string, unknown> | null {
	if (value === null || value === undefined) {
		return {};
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

/**
 * Strictly normalize the `usage` object of a Realtime `response.done` event.
 * Returns a failure (never an estimate) when the shape is malformed or the
 * modality details do not add up to the reported totals — the caller treats
 * that as an unpriceable event and closes the session.
 */
export function normalizeRealtimeUsage(
	rawUsage: unknown,
): NormalizeRealtimeUsageResult {
	if (rawUsage === null || rawUsage === undefined) {
		return { ok: false, reason: "missing usage object" };
	}
	const usage = asObject(rawUsage);
	if (!usage) {
		return { ok: false, reason: "usage is not an object" };
	}

	const totalTokens = readCount(usage.total_tokens);
	const inputTokens = readCount(usage.input_tokens);
	const outputTokens = readCount(usage.output_tokens);
	if (totalTokens === null || inputTokens === null || outputTokens === null) {
		return { ok: false, reason: "malformed token totals" };
	}
	if (totalTokens !== inputTokens + outputTokens) {
		return { ok: false, reason: "total_tokens does not match input + output" };
	}

	const inputDetails = asObject(usage.input_token_details);
	if (!inputDetails) {
		return { ok: false, reason: "malformed input_token_details" };
	}
	const inputTextTokens = readCount(inputDetails.text_tokens);
	const inputAudioTokens = readCount(inputDetails.audio_tokens);
	const inputImageTokens = readCount(inputDetails.image_tokens);
	const cachedTokens = readCount(inputDetails.cached_tokens);
	if (
		inputTextTokens === null ||
		inputAudioTokens === null ||
		inputImageTokens === null ||
		cachedTokens === null
	) {
		return { ok: false, reason: "malformed input modality counts" };
	}
	if (inputTextTokens + inputAudioTokens + inputImageTokens !== inputTokens) {
		return {
			ok: false,
			reason: "input modality counts do not sum to input_tokens",
		};
	}

	const cachedDetails = asObject(inputDetails.cached_tokens_details);
	if (!cachedDetails) {
		return { ok: false, reason: "malformed cached_tokens_details" };
	}
	const cachedTextTokens = readCount(cachedDetails.text_tokens);
	const cachedAudioTokens = readCount(cachedDetails.audio_tokens);
	const cachedImageTokens = readCount(cachedDetails.image_tokens);
	if (
		cachedTextTokens === null ||
		cachedAudioTokens === null ||
		cachedImageTokens === null
	) {
		return { ok: false, reason: "malformed cached modality counts" };
	}
	if (cachedTokens > 0 || Object.keys(cachedDetails).length > 0) {
		if (
			cachedTextTokens + cachedAudioTokens + cachedImageTokens !==
			cachedTokens
		) {
			return {
				ok: false,
				reason: "cached modality counts do not sum to cached_tokens",
			};
		}
	}
	if (
		cachedTextTokens > inputTextTokens ||
		cachedAudioTokens > inputAudioTokens ||
		cachedImageTokens > inputImageTokens
	) {
		return {
			ok: false,
			reason: "cached modality counts exceed input modality counts",
		};
	}

	const outputDetails = asObject(usage.output_token_details);
	if (!outputDetails) {
		return { ok: false, reason: "malformed output_token_details" };
	}
	const outputTextTokens = readCount(outputDetails.text_tokens);
	const outputAudioTokens = readCount(outputDetails.audio_tokens);
	if (outputTextTokens === null || outputAudioTokens === null) {
		return { ok: false, reason: "malformed output modality counts" };
	}
	if (outputTextTokens + outputAudioTokens !== outputTokens) {
		return {
			ok: false,
			reason: "output modality counts do not sum to output_tokens",
		};
	}

	return {
		ok: true,
		usage: {
			totalTokens,
			inputTokens,
			outputTokens,
			inputTextTokens,
			inputAudioTokens,
			inputImageTokens,
			cachedTokens,
			cachedTextTokens,
			cachedAudioTokens,
			cachedImageTokens,
			outputTextTokens,
			outputAudioTokens,
		},
	};
}

/**
 * Exact per-token prices (decimal strings, USD) captured from the catalogue at
 * billing time. Persisted alongside each billed event for auditability.
 * A missing price means the modality is unpriceable: usage in that modality
 * fails the pricing step rather than being estimated or dropped.
 */
export interface RealtimePriceSnapshot {
	textInput?: string;
	cachedTextInput?: string;
	audioInput?: string;
	cachedAudioInput?: string;
	imageInput?: string;
	cachedImageInput?: string;
	textOutput?: string;
	audioOutput?: string;
	// Realtime billing is purely per-token. Captured only so a mapping that
	// declares a non-zero flat per-request price fails as unpriceable instead
	// of silently under-billing.
	requestPrice?: string;
}

export function buildRealtimePriceSnapshot(
	mapping: Pick<
		ProviderModelMapping,
		| "inputPrice"
		| "cachedInputPrice"
		| "inputAudioPrice"
		| "cachedInputAudioPrice"
		| "imageInputPrice"
		| "cachedImageInputPrice"
		| "outputPrice"
		| "outputAudioPrice"
		| "requestPrice"
	>,
): RealtimePriceSnapshot {
	return {
		textInput: mapping.inputPrice,
		cachedTextInput: mapping.cachedInputPrice,
		audioInput: mapping.inputAudioPrice ?? mapping.inputPrice,
		cachedAudioInput: mapping.cachedInputAudioPrice ?? mapping.cachedInputPrice,
		imageInput: mapping.imageInputPrice,
		// No text-cache fallback for cached image tokens: providers price them
		// differently, so an undeclared price must fail as unpriceable rather
		// than silently bill at the wrong rate.
		cachedImageInput: mapping.cachedImageInputPrice,
		textOutput: mapping.outputPrice,
		audioOutput: mapping.outputAudioPrice ?? mapping.outputPrice,
		requestPrice: mapping.requestPrice,
	};
}

export interface RealtimeCostBreakdown {
	inputCost: Decimal;
	cachedInputCost: Decimal;
	audioInputCost: Decimal;
	imageInputCost: Decimal;
	outputCost: Decimal;
	audioOutputCost: Decimal;
	totalCost: Decimal;
}

export type PriceRealtimeUsageResult =
	{ ok: true; costs: RealtimeCostBreakdown } | { ok: false; reason: string };

function priceComponent(
	tokens: number,
	price: string | undefined,
	label: string,
): Decimal | { error: string } {
	if (tokens === 0) {
		return new Decimal(0);
	}
	if (price === undefined) {
		return { error: `no price configured for ${label} tokens` };
	}
	return new Decimal(price).times(tokens);
}

/**
 * Price a normalized usage block against a price snapshot using exact decimal
 * arithmetic. Uncached counts are derived per modality (modality total minus
 * cached) so cached tokens are never double-billed.
 */
export function priceRealtimeUsage(
	usage: NormalizedRealtimeUsage,
	snapshot: RealtimePriceSnapshot,
): PriceRealtimeUsageResult {
	// This function bills tokens only. A mapping carrying a flat per-request
	// price would be under-billed silently, so fail closed instead.
	if (
		snapshot.requestPrice !== undefined &&
		!new Decimal(snapshot.requestPrice).isZero()
	) {
		return {
			ok: false,
			reason: "per-request pricing is not supported for realtime sessions",
		};
	}

	const components: Array<
		[keyof RealtimeCostBreakdown, Decimal | { error: string }]
	> = [
		[
			"inputCost",
			priceComponent(
				usage.inputTextTokens - usage.cachedTextTokens,
				snapshot.textInput,
				"text input",
			),
		],
		[
			"cachedInputCost",
			priceComponent(
				usage.cachedTextTokens,
				snapshot.cachedTextInput,
				"cached text input",
			),
		],
		[
			"audioInputCost",
			priceComponent(
				usage.inputAudioTokens - usage.cachedAudioTokens,
				snapshot.audioInput,
				"audio input",
			),
		],
		[
			"imageInputCost",
			priceComponent(
				usage.inputImageTokens - usage.cachedImageTokens,
				snapshot.imageInput,
				"image input",
			),
		],
		[
			"outputCost",
			priceComponent(
				usage.outputTextTokens,
				snapshot.textOutput,
				"text output",
			),
		],
		[
			"audioOutputCost",
			priceComponent(
				usage.outputAudioTokens,
				snapshot.audioOutput,
				"audio output",
			),
		],
	];

	// Cached audio and cached image are folded into their own components so the
	// stored breakdown mirrors the log columns (cachedInputCost covers text;
	// audio/image components carry their cached share at the cached rate).
	const cachedAudio = priceComponent(
		usage.cachedAudioTokens,
		snapshot.cachedAudioInput,
		"cached audio input",
	);
	const cachedImage = priceComponent(
		usage.cachedImageTokens,
		snapshot.cachedImageInput,
		"cached image input",
	);

	const resolved: Partial<Record<keyof RealtimeCostBreakdown, Decimal>> = {};
	for (const [key, value] of components) {
		if (value instanceof Decimal) {
			resolved[key] = value;
		} else {
			return { ok: false, reason: value.error };
		}
	}
	if (!(cachedAudio instanceof Decimal)) {
		return { ok: false, reason: cachedAudio.error };
	}
	if (!(cachedImage instanceof Decimal)) {
		return { ok: false, reason: cachedImage.error };
	}

	const audioInputCost = resolved.audioInputCost!.plus(cachedAudio);
	const imageInputCost = resolved.imageInputCost!.plus(cachedImage);
	const costs: RealtimeCostBreakdown = {
		inputCost: resolved.inputCost!,
		cachedInputCost: resolved.cachedInputCost!,
		audioInputCost,
		imageInputCost,
		outputCost: resolved.outputCost!,
		audioOutputCost: resolved.audioOutputCost!,
		totalCost: resolved
			.inputCost!.plus(resolved.cachedInputCost!)
			.plus(audioInputCost)
			.plus(imageInputCost)
			.plus(resolved.outputCost!)
			.plus(resolved.audioOutputCost!),
	};

	return { ok: true, costs };
}

/**
 * Scale every component of a cost breakdown by the organization's effective
 * discount, matching how the HTTP paths apply getEffectiveDiscount().
 */
export function applyRealtimeDiscount(
	costs: RealtimeCostBreakdown,
	discount: Decimal,
): RealtimeCostBreakdown {
	if (discount.isZero()) {
		return costs;
	}
	const multiplier = new Decimal(1).minus(discount);
	return {
		inputCost: costs.inputCost.times(multiplier),
		cachedInputCost: costs.cachedInputCost.times(multiplier),
		audioInputCost: costs.audioInputCost.times(multiplier),
		imageInputCost: costs.imageInputCost.times(multiplier),
		outputCost: costs.outputCost.times(multiplier),
		audioOutputCost: costs.audioOutputCost.times(multiplier),
		totalCost: costs.totalCost.times(multiplier),
	};
}
