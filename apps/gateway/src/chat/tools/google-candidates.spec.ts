import { describe, expect, it } from "vitest";

import { dedupeGoogleCandidateParts } from "./google-candidates.js";

describe("dedupeGoogleCandidateParts", () => {
	it("strips the duplicated suffix from candidate 0 (AI Studio quirk)", () => {
		const candidates = [
			{
				content: {
					parts: [{ text: "Cerulean" }, { text: "Aqua" }, { text: "Red" }],
					role: "model",
				},
				finishReason: "STOP",
				index: 0,
			},
			{
				content: { parts: [{ text: "Aqua" }], role: "model" },
				finishReason: "STOP",
				index: 1,
			},
			{
				content: { parts: [{ text: "Red" }], role: "model" },
				finishReason: "STOP",
				index: 2,
			},
		];

		const result = dedupeGoogleCandidateParts(candidates);

		expect(result[0].content.parts).toEqual([{ text: "Cerulean" }]);
		expect(result[0].finishReason).toBe("STOP");
		expect(result[1].content.parts).toEqual([{ text: "Aqua" }]);
		expect(result[2].content.parts).toEqual([{ text: "Red" }]);
		// Input must not be mutated
		expect(candidates[0].content.parts).toHaveLength(3);
	});

	it("strips duplicated thought and functionCall parts", () => {
		const candidates = [
			{
				content: {
					parts: [
						{ text: "thinking A", thought: true },
						{
							functionCall: { name: "get_weather", args: { city: "Paris" } },
						},
						{ text: "thinking B", thought: true },
						{
							functionCall: { name: "get_weather", args: { city: "Rome" } },
						},
					],
					role: "model",
				},
				index: 0,
			},
			{
				content: {
					parts: [
						{ text: "thinking B", thought: true },
						{
							functionCall: { name: "get_weather", args: { city: "Rome" } },
						},
					],
					role: "model",
				},
				index: 1,
			},
		];

		const result = dedupeGoogleCandidateParts(candidates);

		expect(result[0].content.parts).toEqual([
			{ text: "thinking A", thought: true },
			{ functionCall: { name: "get_weather", args: { city: "Paris" } } },
		]);
		expect(result[1].content.parts).toHaveLength(2);
	});

	it("keeps clean responses untouched (Vertex)", () => {
		const candidates = [
			{ content: { parts: [{ text: "Carrot" }], role: "model" } },
			{ content: { parts: [{ text: "Potato" }], role: "model" }, index: 1 },
		];

		expect(dedupeGoogleCandidateParts(candidates)).toBe(candidates);
	});

	it("does not strip when it would empty candidate 0", () => {
		// A clean response where every candidate legitimately produced the
		// same single part: candidate 0's parts equal the suffix exactly and
		// stripping would leave it empty.
		const candidates = [
			{ content: { parts: [{ text: "Hello" }], role: "model" } },
			{ content: { parts: [{ text: "Hello" }], role: "model" }, index: 1 },
		];

		const result = dedupeGoogleCandidateParts(candidates);

		expect(result[0].content.parts).toEqual([{ text: "Hello" }]);
	});

	it("returns single-candidate and empty arrays as-is", () => {
		const single = [{ content: { parts: [{ text: "Hi" }] } }];
		expect(dedupeGoogleCandidateParts(single)).toBe(single);
		const empty: any[] = [];
		expect(dedupeGoogleCandidateParts(empty)).toBe(empty);
	});

	it("ignores candidate 0 without parts", () => {
		const candidates = [
			{ content: { role: "model" } },
			{ content: { parts: [{ text: "B" }], role: "model" }, index: 1 },
		];

		expect(dedupeGoogleCandidateParts(candidates)).toBe(candidates);
	});

	it("does not strip when the tail differs from the other candidates' parts", () => {
		const candidates = [
			{
				content: {
					parts: [{ text: "Own one" }, { text: "Own two" }],
					role: "model",
				},
			},
			{ content: { parts: [{ text: "Other" }], role: "model" }, index: 1 },
		];

		expect(dedupeGoogleCandidateParts(candidates)).toBe(candidates);
	});

	it("does not strip for non-AI-Studio providers even when the suffix matches", () => {
		// A clean Vertex response where candidate 0 legitimately ends with the
		// same part the next candidate produced ([A, B] vs [B]). The suffix would
		// match, but Vertex never appends others' parts, so stripping would drop
		// candidate 0's real trailing part. The provider gate prevents that.
		const candidates = [
			{
				content: { parts: [{ text: "A" }, { text: "B" }], role: "model" },
				index: 0,
			},
			{ content: { parts: [{ text: "B" }], role: "model" }, index: 1 },
		];

		expect(dedupeGoogleCandidateParts(candidates, "google-vertex")).toBe(
			candidates,
		);
		// The same shape from AI Studio is still de-duplicated.
		const stripped = dedupeGoogleCandidateParts(candidates, "google-ai-studio");
		expect(stripped[0].content.parts).toEqual([{ text: "A" }]);
	});
});
