import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import {
	applyTranscriptionDiscount,
	buildTranscriptionPriceSnapshot,
	normalizeTranscriptionUsage,
	priceTranscriptionUsage,
} from "./transcription.js";

describe("normalizeTranscriptionUsage", () => {
	const valid = {
		type: "tokens",
		total_tokens: 30,
		input_tokens: 20,
		output_tokens: 10,
		input_token_details: {
			text_tokens: 2,
			audio_tokens: 18,
		},
	};

	it("normalizes a valid token usage block", () => {
		const result = normalizeTranscriptionUsage(valid);
		expect(result).toEqual({
			ok: true,
			usage: {
				totalTokens: 30,
				inputTokens: 20,
				outputTokens: 10,
				inputTextTokens: 2,
				inputAudioTokens: 18,
				inputAudioSeconds: 0,
			},
		});
	});

	it("normalizes a duration usage block", () => {
		expect(
			normalizeTranscriptionUsage({ type: "duration", seconds: 3.2 }),
		).toEqual({
			ok: true,
			usage: {
				totalTokens: 0,
				inputTokens: 0,
				outputTokens: 0,
				inputTextTokens: 0,
				inputAudioTokens: 0,
				inputAudioSeconds: 3.2,
			},
		});
	});

	it("rejects malformed duration seconds", () => {
		expect(normalizeTranscriptionUsage({ type: "duration" }).ok).toBe(false);
		expect(
			normalizeTranscriptionUsage({ type: "duration", seconds: -1 }).ok,
		).toBe(false);
		expect(
			normalizeTranscriptionUsage({ type: "duration", seconds: "3" }).ok,
		).toBe(false);
	});

	it("rejects missing usage", () => {
		expect(normalizeTranscriptionUsage(undefined).ok).toBe(false);
		expect(normalizeTranscriptionUsage(null).ok).toBe(false);
	});

	it("rejects missing usage type", () => {
		const result = normalizeTranscriptionUsage({ total_tokens: 1 });
		expect(result).toEqual({
			ok: false,
			reason: "unsupported usage type: missing",
		});
	});

	it("rejects totals that do not add up", () => {
		const result = normalizeTranscriptionUsage({
			...valid,
			total_tokens: 31,
		});
		expect(result).toEqual({
			ok: false,
			reason: "total_tokens does not match input + output",
		});
	});

	it("rejects modality counts that do not sum to input_tokens", () => {
		const result = normalizeTranscriptionUsage({
			...valid,
			input_token_details: { text_tokens: 5, audio_tokens: 18 },
		});
		expect(result).toEqual({
			ok: false,
			reason: "input modality counts do not sum to input_tokens",
		});
	});

	it("rejects non-integer counts", () => {
		const result = normalizeTranscriptionUsage({
			...valid,
			input_tokens: 1.5,
		});
		expect(result).toEqual({ ok: false, reason: "malformed token totals" });
	});

	it("rejects negative counts", () => {
		const result = normalizeTranscriptionUsage({
			...valid,
			output_tokens: -1,
		});
		expect(result).toEqual({ ok: false, reason: "malformed token totals" });
	});

	it("treats missing input_token_details as zero counts only when consistent", () => {
		const result = normalizeTranscriptionUsage({
			type: "tokens",
			total_tokens: 0,
			input_tokens: 0,
			output_tokens: 0,
		});
		expect(result.ok).toBe(true);

		const inconsistent = normalizeTranscriptionUsage({
			type: "tokens",
			total_tokens: 3,
			input_tokens: 2,
			output_tokens: 1,
		});
		expect(inconsistent).toEqual({
			ok: false,
			reason: "input modality counts do not sum to input_tokens",
		});
	});
});

describe("priceTranscriptionUsage", () => {
	const snapshot = buildTranscriptionPriceSnapshot({
		inputPrice: "1.25e-6",
		inputAudioPrice: "3.0e-6",
		outputPrice: "5.0e-6",
	});

	it("prices each modality with exact decimal arithmetic", () => {
		const result = priceTranscriptionUsage(
			{
				totalTokens: 30,
				inputTokens: 20,
				outputTokens: 10,
				inputTextTokens: 2,
				inputAudioTokens: 18,
				inputAudioSeconds: 0,
			},
			snapshot,
		);
		if (!result.ok) {
			throw new Error(`expected ok, got ${result.reason}`);
		}
		expect(result.costs.inputCost.toString()).toBe("0.0000025");
		expect(result.costs.audioInputCost.toString()).toBe("0.000054");
		expect(result.costs.outputCost.toString()).toBe("0.00005");
		expect(result.costs.totalCost.toString()).toBe("0.0001065");
	});

	it("fails for usage in a modality without a configured price", () => {
		const result = priceTranscriptionUsage(
			{
				totalTokens: 5,
				inputTokens: 5,
				outputTokens: 0,
				inputTextTokens: 0,
				inputAudioTokens: 5,
				inputAudioSeconds: 0,
			},
			buildTranscriptionPriceSnapshot({
				inputPrice: undefined,
				inputAudioPrice: undefined,
				outputPrice: "5.0e-6",
			}),
		);
		expect(result).toEqual({
			ok: false,
			reason: "no price configured for audio input tokens",
		});
	});

	it("falls back to inputPrice for audio tokens when inputAudioPrice is unset", () => {
		const result = priceTranscriptionUsage(
			{
				totalTokens: 10,
				inputTokens: 10,
				outputTokens: 0,
				inputTextTokens: 0,
				inputAudioTokens: 10,
				inputAudioSeconds: 0,
			},
			buildTranscriptionPriceSnapshot({
				inputPrice: "2e-6",
				inputAudioPrice: undefined,
				outputPrice: "5e-6",
			}),
		);
		if (!result.ok) {
			throw new Error(`expected ok, got ${result.reason}`);
		}
		expect(result.costs.audioInputCost.toString()).toBe("0.00002");
	});

	it("prices duration usage against the per-hour audio price", () => {
		const result = priceTranscriptionUsage(
			{
				totalTokens: 0,
				inputTokens: 0,
				outputTokens: 0,
				inputTextTokens: 0,
				inputAudioTokens: 0,
				inputAudioSeconds: 90,
			},
			buildTranscriptionPriceSnapshot({
				inputPrice: "0",
				outputPrice: "0",
				inputAudioHourPrice: "1.02",
			}),
		);
		if (!result.ok) {
			throw new Error(`expected ok, got ${result.reason}`);
		}
		// 90s at $1.02/h = $0.0255 (i.e. 1.5 min at $0.017/min).
		expect(result.costs.audioInputCost.toString()).toBe("0.0255");
		expect(result.costs.inputCost.toString()).toBe("0");
		expect(result.costs.outputCost.toString()).toBe("0");
		expect(result.costs.totalCost.toString()).toBe("0.0255");
	});

	it("fails for duration usage on a token-priced mapping", () => {
		const result = priceTranscriptionUsage(
			{
				totalTokens: 0,
				inputTokens: 0,
				outputTokens: 0,
				inputTextTokens: 0,
				inputAudioTokens: 0,
				inputAudioSeconds: 12,
			},
			snapshot,
		);
		expect(result).toEqual({
			ok: false,
			reason: "no price configured for audio input duration",
		});
	});

	it("fails for token usage on a duration-priced mapping instead of billing zero", () => {
		const result = priceTranscriptionUsage(
			{
				totalTokens: 10,
				inputTokens: 10,
				outputTokens: 0,
				inputTextTokens: 0,
				inputAudioTokens: 10,
				inputAudioSeconds: 0,
			},
			buildTranscriptionPriceSnapshot({
				inputPrice: "0",
				outputPrice: "0",
				inputAudioHourPrice: "1.02",
			}),
		);
		expect(result).toEqual({
			ok: false,
			reason: "no price configured for audio input tokens",
		});
	});
});

describe("applyTranscriptionDiscount", () => {
	it("scales every component", () => {
		const base = priceTranscriptionUsage(
			{
				totalTokens: 30,
				inputTokens: 20,
				outputTokens: 10,
				inputTextTokens: 2,
				inputAudioTokens: 18,
				inputAudioSeconds: 0,
			},
			buildTranscriptionPriceSnapshot({
				inputPrice: "1e-6",
				inputAudioPrice: "2e-6",
				outputPrice: "4e-6",
			}),
		);
		if (!base.ok) {
			throw new Error("expected ok");
		}
		const discounted = applyTranscriptionDiscount(
			base.costs,
			new Decimal("0.5"),
		);
		expect(discounted.totalCost.toString()).toBe(
			base.costs.totalCost.dividedBy(2).toString(),
		);
		expect(discounted.inputCost.toString()).toBe(
			base.costs.inputCost.dividedBy(2).toString(),
		);
	});

	it("returns the input unchanged for a zero discount", () => {
		const base = priceTranscriptionUsage(
			{
				totalTokens: 1,
				inputTokens: 1,
				outputTokens: 0,
				inputTextTokens: 1,
				inputAudioTokens: 0,
				inputAudioSeconds: 0,
			},
			buildTranscriptionPriceSnapshot({
				inputPrice: "1e-6",
				inputAudioPrice: "2e-6",
				outputPrice: "4e-6",
			}),
		);
		if (!base.ok) {
			throw new Error("expected ok");
		}
		expect(applyTranscriptionDiscount(base.costs, new Decimal(0))).toBe(
			base.costs,
		);
	});
});
