import { describe, expect, it } from "vitest";

import {
	buildRealtimePriceSnapshot,
	normalizeRealtimeUsage,
	priceRealtimeUsage,
	type NormalizedRealtimeUsage,
} from "./pricing.js";

function validUsage(): Record<string, unknown> {
	return {
		total_tokens: 1500,
		input_tokens: 1000,
		output_tokens: 500,
		input_token_details: {
			text_tokens: 300,
			audio_tokens: 700,
			cached_tokens: 200,
			cached_tokens_details: {
				text_tokens: 50,
				audio_tokens: 150,
			},
		},
		output_token_details: {
			text_tokens: 100,
			audio_tokens: 400,
		},
	};
}

describe("normalizeRealtimeUsage", () => {
	it("normalizes a well-formed usage block", () => {
		const result = normalizeRealtimeUsage(validUsage());
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.usage).toEqual({
			totalTokens: 1500,
			inputTokens: 1000,
			outputTokens: 500,
			inputTextTokens: 300,
			inputAudioTokens: 700,
			inputImageTokens: 0,
			cachedTokens: 200,
			cachedTextTokens: 50,
			cachedAudioTokens: 150,
			cachedImageTokens: 0,
			outputTextTokens: 100,
			outputAudioTokens: 400,
		} satisfies NormalizedRealtimeUsage);
	});

	it("accepts an all-zero usage block (cancelled before any tokens)", () => {
		const result = normalizeRealtimeUsage({
			total_tokens: 0,
			input_tokens: 0,
			output_tokens: 0,
			input_token_details: {
				text_tokens: 0,
				audio_tokens: 0,
				cached_tokens: 0,
				cached_tokens_details: {},
			},
			output_token_details: { text_tokens: 0, audio_tokens: 0 },
		});
		expect(result.ok).toBe(true);
	});

	it("rejects a missing usage object", () => {
		expect(normalizeRealtimeUsage(undefined).ok).toBe(false);
		expect(normalizeRealtimeUsage(null).ok).toBe(false);
	});

	it("rejects totals that do not add up", () => {
		const usage = validUsage();
		usage.total_tokens = 9999;
		expect(normalizeRealtimeUsage(usage).ok).toBe(false);
	});

	it("rejects an unknown input modality (details do not sum to input_tokens)", () => {
		const usage = validUsage();
		// Simulate a new billable dimension we don't understand: input_tokens
		// includes 100 tokens not covered by text/audio/image details.
		usage.input_tokens = 1100;
		usage.total_tokens = 1600;
		expect(normalizeRealtimeUsage(usage).ok).toBe(false);
	});

	it("rejects cached counts exceeding modality counts", () => {
		const usage = validUsage();
		(usage.input_token_details as Record<string, unknown>).cached_tokens = 400;
		(
			(usage.input_token_details as Record<string, unknown>)
				.cached_tokens_details as Record<string, unknown>
		).text_tokens = 350;
		(
			(usage.input_token_details as Record<string, unknown>)
				.cached_tokens_details as Record<string, unknown>
		).audio_tokens = 50;
		expect(normalizeRealtimeUsage(usage).ok).toBe(false);
	});

	it("rejects cached details that do not sum to cached_tokens", () => {
		const usage = validUsage();
		(usage.input_token_details as Record<string, unknown>).cached_tokens = 199;
		expect(normalizeRealtimeUsage(usage).ok).toBe(false);
	});

	it("rejects non-integer and negative counts", () => {
		const withFloat = validUsage();
		withFloat.input_tokens = 1000.5;
		expect(normalizeRealtimeUsage(withFloat).ok).toBe(false);

		const withNegative = validUsage();
		(withNegative.output_token_details as Record<string, unknown>).text_tokens =
			-1;
		expect(normalizeRealtimeUsage(withNegative).ok).toBe(false);
	});

	it("rejects output details that do not sum to output_tokens", () => {
		const usage = validUsage();
		(usage.output_token_details as Record<string, unknown>).audio_tokens = 399;
		expect(normalizeRealtimeUsage(usage).ok).toBe(false);
	});
});

describe("priceRealtimeUsage", () => {
	// gpt-realtime published prices (USD per token).
	const gptRealtimeMapping = {
		inputPrice: "4.0e-6",
		cachedInputPrice: "0.4e-6",
		outputPrice: "16.0e-6",
		inputAudioPrice: "32.0e-6",
		cachedInputAudioPrice: "0.4e-6",
		outputAudioPrice: "64.0e-6",
		imageInputPrice: "5.0e-6",
	};

	it("prices every modality with exact decimal arithmetic", () => {
		const normalized = normalizeRealtimeUsage(validUsage());
		expect(normalized.ok).toBe(true);
		if (!normalized.ok) {
			return;
		}
		const snapshot = buildRealtimePriceSnapshot(gptRealtimeMapping);
		const priced = priceRealtimeUsage(normalized.usage, snapshot);
		expect(priced.ok).toBe(true);
		if (!priced.ok) {
			return;
		}
		// uncached text: 250 * 4e-6 = 0.001
		expect(priced.costs.inputCost.toString()).toBe("0.001");
		// cached text: 50 * 0.4e-6 = 0.00002
		expect(priced.costs.cachedInputCost.toString()).toBe("0.00002");
		// audio: 550 uncached * 32e-6 + 150 cached * 0.4e-6 = 0.0176 + 0.00006
		expect(priced.costs.audioInputCost.toString()).toBe("0.01766");
		// text output: 100 * 16e-6
		expect(priced.costs.outputCost.toString()).toBe("0.0016");
		// audio output: 400 * 64e-6
		expect(priced.costs.audioOutputCost.toString()).toBe("0.0256");
		expect(priced.costs.imageInputCost.toString()).toBe("0");
		// total = 0.001 + 0.00002 + 0.01766 + 0.0016 + 0.0256
		expect(priced.costs.totalCost.toString()).toBe("0.04588");
	});

	it("prices a zero-usage response as zero", () => {
		const normalized = normalizeRealtimeUsage({
			total_tokens: 0,
			input_tokens: 0,
			output_tokens: 0,
			input_token_details: {
				text_tokens: 0,
				audio_tokens: 0,
				cached_tokens: 0,
				cached_tokens_details: {},
			},
			output_token_details: { text_tokens: 0, audio_tokens: 0 },
		});
		expect(normalized.ok).toBe(true);
		if (!normalized.ok) {
			return;
		}
		const priced = priceRealtimeUsage(
			normalized.usage,
			buildRealtimePriceSnapshot(gptRealtimeMapping),
		);
		expect(priced.ok).toBe(true);
		if (!priced.ok) {
			return;
		}
		expect(priced.costs.totalCost.toString()).toBe("0");
	});

	it("fails (never estimates) when a used modality has no price", () => {
		const normalized = normalizeRealtimeUsage({
			total_tokens: 10,
			input_tokens: 10,
			output_tokens: 0,
			input_token_details: {
				text_tokens: 0,
				audio_tokens: 0,
				image_tokens: 10,
				cached_tokens: 0,
				cached_tokens_details: {},
			},
			output_token_details: { text_tokens: 0, audio_tokens: 0 },
		});
		expect(normalized.ok).toBe(true);
		if (!normalized.ok) {
			return;
		}
		const snapshot = buildRealtimePriceSnapshot({
			...gptRealtimeMapping,
			imageInputPrice: undefined,
		});
		const priced = priceRealtimeUsage(normalized.usage, snapshot);
		expect(priced.ok).toBe(false);
	});

	it("falls back audio prices to text prices when not declared", () => {
		const snapshot = buildRealtimePriceSnapshot({
			inputPrice: "1e-6",
			cachedInputPrice: "0.5e-6",
			outputPrice: "2e-6",
		});
		expect(snapshot.audioInput).toBe("1e-6");
		expect(snapshot.cachedAudioInput).toBe("0.5e-6");
		expect(snapshot.audioOutput).toBe("2e-6");
	});

	it("avoids float rounding noise on large token counts", () => {
		const normalized = normalizeRealtimeUsage({
			total_tokens: 3_000_000,
			input_tokens: 2_000_000,
			output_tokens: 1_000_000,
			input_token_details: {
				text_tokens: 1_000_000,
				audio_tokens: 1_000_000,
				cached_tokens: 0,
				cached_tokens_details: {},
			},
			output_token_details: {
				text_tokens: 500_000,
				audio_tokens: 500_000,
			},
		});
		expect(normalized.ok).toBe(true);
		if (!normalized.ok) {
			return;
		}
		const priced = priceRealtimeUsage(
			normalized.usage,
			buildRealtimePriceSnapshot(gptRealtimeMapping),
		);
		expect(priced.ok).toBe(true);
		if (!priced.ok) {
			return;
		}
		// 1M text * $4/M + 1M audio * $32/M + 0.5M text out * $16/M + 0.5M audio
		// out * $64/M = 4 + 32 + 8 + 32 = 76 exactly.
		expect(priced.costs.totalCost.toString()).toBe("76");
	});
});
