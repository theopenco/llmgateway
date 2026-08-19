import { describe, expect, it } from "vitest";

import { normalizeGeminiRealtimeUsage } from "./gemini-pricing.js";

function detail(modality: string, tokenCount: number) {
	return { modality, tokenCount };
}

describe("normalizeGeminiRealtimeUsage", () => {
	it("normalizes a plain audio-in / audio-out generation", () => {
		const result = normalizeGeminiRealtimeUsage({
			promptTokenCount: 120,
			responseTokenCount: 80,
			totalTokenCount: 200,
			promptTokensDetails: [detail("AUDIO", 100), detail("TEXT", 20)],
			responseTokensDetails: [detail("AUDIO", 75), detail("TEXT", 5)],
		});
		expect(result).toEqual({
			ok: true,
			billable: true,
			usage: {
				totalTokens: 200,
				inputTokens: 120,
				outputTokens: 80,
				inputTextTokens: 20,
				inputAudioTokens: 100,
				inputImageTokens: 0,
				cachedTokens: 0,
				cachedTextTokens: 0,
				cachedAudioTokens: 0,
				cachedImageTokens: 0,
				outputTextTokens: 5,
				outputAudioTokens: 75,
			},
		});
	});

	it("maps cached content tokens onto the cached modality counts", () => {
		const result = normalizeGeminiRealtimeUsage({
			promptTokenCount: 100,
			cachedContentTokenCount: 40,
			responseTokenCount: 10,
			totalTokenCount: 110,
			promptTokensDetails: [detail("AUDIO", 60), detail("TEXT", 40)],
			cacheTokensDetails: [detail("TEXT", 30), detail("AUDIO", 10)],
			responseTokensDetails: [detail("AUDIO", 10)],
		});
		expect(result).toMatchObject({
			ok: true,
			billable: true,
			usage: {
				cachedTokens: 40,
				cachedTextTokens: 30,
				cachedAudioTokens: 10,
			},
		});
	});

	// Verbatim from a live Gemini session. The Live API excludes
	// thoughtsTokenCount from totalTokenCount (368 + 101 = 469, not 506), and
	// thoughts are absent from responseTokensDetails too — so they are added to
	// text output exactly once, and the reported grand total runs low.
	it("bills thinking tokens at the text output rate", () => {
		const result = normalizeGeminiRealtimeUsage({
			promptTokenCount: 368,
			responseTokenCount: 101,
			totalTokenCount: 469,
			promptTokensDetails: [detail("TEXT", 367), detail("AUDIO", 1)],
			responseTokensDetails: [detail("AUDIO", 101)],
			thoughtsTokenCount: 37,
		});
		expect(result).toEqual({
			ok: true,
			billable: true,
			usage: {
				totalTokens: 506,
				inputTokens: 368,
				outputTokens: 138,
				inputTextTokens: 367,
				inputAudioTokens: 1,
				inputImageTokens: 0,
				cachedTokens: 0,
				cachedTextTokens: 0,
				cachedAudioTokens: 0,
				cachedImageTokens: 0,
				outputTextTokens: 37,
				outputAudioTokens: 101,
			},
		});
	});

	it("accepts a grand total that already includes thoughts", () => {
		// Tolerated in case Google ever starts folding thoughts into the total.
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: 10,
				responseTokenCount: 20,
				thoughtsTokenCount: 7,
				totalTokenCount: 37,
				promptTokensDetails: [detail("TEXT", 10)],
				responseTokensDetails: [detail("AUDIO", 20)],
			}),
		).toMatchObject({
			ok: true,
			billable: true,
			usage: { outputTokens: 27, outputTextTokens: 7, totalTokens: 37 },
		});
	});

	it("folds tool-use prompt tokens into the input modalities", () => {
		const result = normalizeGeminiRealtimeUsage({
			promptTokenCount: 50,
			toolUsePromptTokenCount: 15,
			responseTokenCount: 5,
			totalTokenCount: 70,
			promptTokensDetails: [detail("AUDIO", 50)],
			toolUsePromptTokensDetails: [detail("TEXT", 15)],
			responseTokensDetails: [detail("TEXT", 5)],
		});
		expect(result).toMatchObject({
			ok: true,
			billable: true,
			usage: {
				inputTokens: 65,
				inputTextTokens: 15,
				inputAudioTokens: 50,
			},
		});
	});

	it("counts native transcription output as text output tokens", () => {
		const result = normalizeGeminiRealtimeUsage({
			promptTokenCount: 30,
			responseTokenCount: 44,
			totalTokenCount: 74,
			promptTokensDetails: [detail("AUDIO", 30)],
			// Enabled input/output transcription shows up as TEXT response tokens.
			responseTokensDetails: [detail("AUDIO", 40), detail("TEXT", 4)],
		});
		expect(result).toMatchObject({
			ok: true,
			billable: true,
			usage: { outputTextTokens: 4, outputAudioTokens: 40 },
		});
	});

	// Verbatim from a live Gemini 3.1 Flash Live session. Its prompt details
	// leave ~18 tokens per turn unattributed to any modality (measured gaps of
	// 18/36/54 over three turns), including on a turn with no audio anywhere —
	// so they are structural, still charged, and billed as text input.
	it("bills prompt tokens no modality claims at the text input rate", () => {
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: 142,
				responseTokenCount: 56,
				totalTokenCount: 198,
				promptTokensDetails: [detail("TEXT", 124)],
				responseTokensDetails: [detail("AUDIO", 56)],
			}),
		).toMatchObject({
			ok: true,
			billable: true,
			usage: {
				inputTokens: 142,
				inputTextTokens: 142,
				inputAudioTokens: 0,
				outputAudioTokens: 56,
			},
		});
	});

	it("keeps audio attribution intact when only part is unattributed", () => {
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: 355,
				responseTokenCount: 26,
				totalTokenCount: 381,
				promptTokensDetails: [detail("TEXT", 157), detail("AUDIO", 144)],
				responseTokensDetails: [detail("AUDIO", 26)],
			}),
		).toMatchObject({
			ok: true,
			billable: true,
			// 157 attributed text + 54 unattributed; audio is untouched.
			usage: { inputTextTokens: 211, inputAudioTokens: 144, inputTokens: 355 },
		});
	});

	// A short opening turn attributes fewer tokens than the structural gap, so
	// the proportional guard alone would fail an ordinary "hi" and close the
	// call.
	it("allows a structural gap larger than the tokens it accompanies", () => {
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: 30,
				responseTokenCount: 24,
				totalTokenCount: 54,
				promptTokensDetails: [detail("AUDIO", 12)],
				responseTokensDetails: [detail("AUDIO", 24)],
			}),
		).toMatchObject({
			ok: true,
			billable: true,
			usage: { inputTextTokens: 18, inputAudioTokens: 12, inputTokens: 30 },
		});
	});

	it("rejects a block whose details explain less than half the prompt", () => {
		const result = normalizeGeminiRealtimeUsage({
			promptTokenCount: 1000,
			responseTokenCount: 0,
			promptTokensDetails: [detail("TEXT", 100)],
		});
		expect(result).toMatchObject({ ok: false });
		expect((result as { reason: string }).reason).toContain("unattributed");
	});

	it("still rejects response details that do not add up", () => {
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: 10,
				responseTokenCount: 100,
				promptTokensDetails: [detail("TEXT", 10)],
				responseTokensDetails: [detail("AUDIO", 60)],
			}),
		).toMatchObject({ ok: false });
	});

	it("reports an all-zero usage block as non-billable", () => {
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: 0,
				responseTokenCount: 0,
				totalTokenCount: 0,
			}),
		).toEqual({ ok: true, billable: false });
	});

	it("rejects a missing usage object", () => {
		expect(normalizeGeminiRealtimeUsage(undefined)).toMatchObject({
			ok: false,
		});
		expect(normalizeGeminiRealtimeUsage(null)).toMatchObject({ ok: false });
		expect(normalizeGeminiRealtimeUsage([])).toMatchObject({ ok: false });
	});

	it.each([
		["IMAGE", "image"],
		["VIDEO", "video"],
		["DOCUMENT", "document"],
	])("rejects %s usage as unpriceable", (modality) => {
		const result = normalizeGeminiRealtimeUsage({
			promptTokenCount: 10,
			responseTokenCount: 0,
			totalTokenCount: 10,
			promptTokensDetails: [detail(modality, 10)],
		});
		expect(result).toMatchObject({ ok: false });
		expect((result as { reason: string }).reason).toContain(modality);
	});

	it("rejects an unknown modality carrying tokens", () => {
		const result = normalizeGeminiRealtimeUsage({
			promptTokenCount: 5,
			responseTokenCount: 0,
			totalTokenCount: 5,
			promptTokensDetails: [detail("HOLOGRAM", 5)],
		});
		expect(result).toMatchObject({ ok: false });
	});

	it("rejects detail arrays that claim more than their total", () => {
		// Over-attribution is always a contradiction; under-attribution is the
		// documented Gemini 3.1 behaviour and is billed as text input instead.
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: 100,
				responseTokenCount: 0,
				promptTokensDetails: [detail("AUDIO", 101)],
			}),
		).toMatchObject({ ok: false });
	});

	it("rejects a positive total with no modality details", () => {
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: 100,
				responseTokenCount: 0,
			}),
		).toMatchObject({ ok: false });
	});

	it.each([
		["negative", -1],
		["fractional", 1.5],
		["non-numeric", "12"],
	])("rejects %s token counts", (_label, value) => {
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: value,
				responseTokenCount: 0,
			}),
		).toMatchObject({ ok: false });
	});

	it("rejects malformed modality detail entries", () => {
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: 10,
				responseTokenCount: 0,
				promptTokensDetails: [{ modality: "AUDIO", tokenCount: "10" }],
			}),
		).toMatchObject({ ok: false });
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: 10,
				responseTokenCount: 0,
				promptTokensDetails: { modality: "AUDIO", tokenCount: 10 },
			}),
		).toMatchObject({ ok: false });
	});

	it("rejects cached counts that exceed their input modality", () => {
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: 10,
				cachedContentTokenCount: 20,
				responseTokenCount: 0,
				promptTokensDetails: [detail("TEXT", 10)],
				cacheTokensDetails: [detail("TEXT", 20)],
			}),
		).toMatchObject({ ok: false });
	});

	it("rejects a grand total larger than the components", () => {
		// A larger reported total means Gemini charged a dimension this
		// normalizer cannot see, so billing the components would underbill.
		const result = normalizeGeminiRealtimeUsage({
			promptTokenCount: 10,
			responseTokenCount: 10,
			totalTokenCount: 25,
			promptTokensDetails: [detail("TEXT", 10)],
			responseTokensDetails: [detail("AUDIO", 10)],
		});
		expect(result).toMatchObject({ ok: false });
		expect((result as { reason: string }).reason).toContain("exceeds");
	});

	it("accepts a usage block that omits totalTokenCount", () => {
		expect(
			normalizeGeminiRealtimeUsage({
				promptTokenCount: 10,
				responseTokenCount: 10,
				promptTokensDetails: [detail("TEXT", 10)],
				responseTokensDetails: [detail("AUDIO", 10)],
			}),
		).toMatchObject({ ok: true, billable: true });
	});
});
