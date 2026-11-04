import { describe, expect, test } from "vitest";

import { getVideoOutputTokenPrice } from "./video-token-pricing.js";

describe("video output token pricing", () => {
	const pricing = {
		default_without_video: "10.7e-6",
		default_with_video: "6.4e-6",
		"1080p_without_video": "11.7e-6",
		"1080p_with_video": "7e-6",
	};

	test.each([
		["480p", false, "10.7e-6"],
		["720p", true, "6.4e-6"],
		["1080p", false, "11.7e-6"],
		["1080P", true, "7e-6"],
	] as const)(
		"selects %s with video input %s",
		(resolution, hasVideoInput, expected) => {
			for (const includeAudio of [true, false]) {
				expect(
					getVideoOutputTokenPrice(pricing, {
						resolution,
						hasVideoInput,
						includeAudio,
					}),
				).toBe(expected);
			}
		},
	);

	test("distinguishes generated audio from reference video", () => {
		const audioPrices = { default_audio: "2.4e-6", default_video: "1.2e-6" };
		expect(
			getVideoOutputTokenPrice(audioPrices, {
				resolution: "1080p",
				includeAudio: false,
				hasVideoInput: true,
			}),
		).toBe("1.2e-6");
		expect(getVideoOutputTokenPrice(audioPrices, { resolution: "480p" })).toBe(
			"2.4e-6",
		);
	});

	test("preserves flat Gemini token rates and zero-priced output", () => {
		expect(getVideoOutputTokenPrice("17.5e-6", {})).toBe("17.5e-6");
		expect(getVideoOutputTokenPrice({ default: "0" }, {})).toBe("0");
	});

	test.each([undefined, null, "", " ", "NaN", "Infinity", "-1"])(
		"rejects missing or invalid prices: %s",
		(price) => {
			expect(getVideoOutputTokenPrice(price, {})).toBeUndefined();
		},
	);

	test("does not hide an invalid resolution rate with a default", () => {
		expect(
			getVideoOutputTokenPrice(
				{ "1080p_without_video": "invalid", default_without_video: "10.7e-6" },
				{ resolution: "1080p" },
			),
		).toBeUndefined();
		expect(getVideoOutputTokenPrice({ unrelated: "1" }, {})).toBeUndefined();
	});
});
