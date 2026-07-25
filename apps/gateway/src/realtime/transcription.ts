import { Decimal } from "decimal.js";

import type { ProviderModelMapping } from "@llmgateway/models";

/**
 * Token counts extracted from a
 * `conversation.item.input_audio_transcription.completed` usage block. Only
 * token-metered usage (`type: "tokens"`) is accepted: duration-based usage
 * cannot be priced against the catalogue's per-token ASR prices, so it fails
 * normalization instead of being estimated.
 */
export interface NormalizedTranscriptionUsage {
	totalTokens: number;
	inputTokens: number;
	outputTokens: number;
	inputTextTokens: number;
	inputAudioTokens: number;
}

export type NormalizeTranscriptionUsageResult =
	| { ok: true; usage: NormalizedTranscriptionUsage }
	| { ok: false; reason: string };

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

/**
 * Strictly normalize the `usage` object of a completed input-audio
 * transcription event. Returns a failure (never an estimate) for malformed
 * shapes, duration-based usage, or modality counts that do not add up.
 */
export function normalizeTranscriptionUsage(
	rawUsage: unknown,
): NormalizeTranscriptionUsageResult {
	if (rawUsage === null || rawUsage === undefined) {
		return { ok: false, reason: "missing usage object" };
	}
	if (typeof rawUsage !== "object" || Array.isArray(rawUsage)) {
		return { ok: false, reason: "usage is not an object" };
	}
	const usage = rawUsage as Record<string, unknown>;

	if (usage.type !== "tokens") {
		return {
			ok: false,
			reason: `unsupported usage type: ${typeof usage.type === "string" ? usage.type : "missing"}`,
		};
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

	const rawDetails = usage.input_token_details;
	if (
		rawDetails !== undefined &&
		rawDetails !== null &&
		(typeof rawDetails !== "object" || Array.isArray(rawDetails))
	) {
		return { ok: false, reason: "malformed input_token_details" };
	}
	const details = (rawDetails ?? {}) as Record<string, unknown>;
	const inputTextTokens = readCount(details.text_tokens);
	const inputAudioTokens = readCount(details.audio_tokens);
	if (inputTextTokens === null || inputAudioTokens === null) {
		return { ok: false, reason: "malformed input modality counts" };
	}
	if (inputTextTokens + inputAudioTokens !== inputTokens) {
		return {
			ok: false,
			reason: "input modality counts do not sum to input_tokens",
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
		},
	};
}

/**
 * Exact per-token ASR prices (decimal strings, USD) captured from the
 * catalogue at billing time and persisted alongside each billed transcription
 * event for auditability.
 */
export interface TranscriptionPriceSnapshot {
	textInput?: string;
	audioInput?: string;
	textOutput?: string;
	// Captured only so a mapping declaring a non-zero flat per-request price
	// fails as unpriceable rather than silently under-billing.
	requestPrice?: string;
}

export function buildTranscriptionPriceSnapshot(
	mapping: Pick<
		ProviderModelMapping,
		"inputPrice" | "inputAudioPrice" | "outputPrice" | "requestPrice"
	>,
): TranscriptionPriceSnapshot {
	return {
		textInput: mapping.inputPrice,
		audioInput: mapping.inputAudioPrice ?? mapping.inputPrice,
		textOutput: mapping.outputPrice,
		requestPrice: mapping.requestPrice,
	};
}

export interface TranscriptionCostBreakdown {
	inputCost: Decimal;
	audioInputCost: Decimal;
	outputCost: Decimal;
	totalCost: Decimal;
}

export type PriceTranscriptionUsageResult =
	| { ok: true; costs: TranscriptionCostBreakdown }
	| { ok: false; reason: string };

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
 * Price a normalized transcription usage block against an ASR price snapshot
 * using exact decimal arithmetic. A modality with usage but no configured
 * price fails rather than being estimated or dropped.
 */
export function priceTranscriptionUsage(
	usage: NormalizedTranscriptionUsage,
	snapshot: TranscriptionPriceSnapshot,
): PriceTranscriptionUsageResult {
	// Token-only billing, as in priceRealtimeUsage: a flat per-request price
	// would be silently dropped, so fail closed instead.
	if (
		snapshot.requestPrice !== undefined &&
		!new Decimal(snapshot.requestPrice).isZero()
	) {
		return {
			ok: false,
			reason: "per-request pricing is not supported for realtime sessions",
		};
	}

	const inputCost = priceComponent(
		usage.inputTextTokens,
		snapshot.textInput,
		"text input",
	);
	if (!(inputCost instanceof Decimal)) {
		return { ok: false, reason: inputCost.error };
	}
	const audioInputCost = priceComponent(
		usage.inputAudioTokens,
		snapshot.audioInput,
		"audio input",
	);
	if (!(audioInputCost instanceof Decimal)) {
		return { ok: false, reason: audioInputCost.error };
	}
	const outputCost = priceComponent(
		usage.outputTokens,
		snapshot.textOutput,
		"text output",
	);
	if (!(outputCost instanceof Decimal)) {
		return { ok: false, reason: outputCost.error };
	}

	return {
		ok: true,
		costs: {
			inputCost,
			audioInputCost,
			outputCost,
			totalCost: inputCost.plus(audioInputCost).plus(outputCost),
		},
	};
}

/**
 * Scale every component of a transcription cost breakdown by the
 * organization's effective discount, matching applyRealtimeDiscount().
 */
export function applyTranscriptionDiscount(
	costs: TranscriptionCostBreakdown,
	discount: Decimal,
): TranscriptionCostBreakdown {
	if (discount.isZero()) {
		return costs;
	}
	const multiplier = new Decimal(1).minus(discount);
	return {
		inputCost: costs.inputCost.times(multiplier),
		audioInputCost: costs.audioInputCost.times(multiplier),
		outputCost: costs.outputCost.times(multiplier),
		totalCost: costs.totalCost.times(multiplier),
	};
}
