import { describe, expect, test } from "vitest";

import { bytedanceModels } from "./models/bytedance.js";

import type { ProviderModelMapping } from "./models.js";

function mapping(id: string): ProviderModelMapping {
	const model = bytedanceModels.find((candidate) => candidate.id === id);
	if (!model) {
		throw new Error(`Missing Seedance model: ${id}`);
	}
	return model.providers[0];
}

describe("Seedance pricing", () => {
	test.each([
		[
			"seedance-2-5",
			{
				default_without_video: "10.7e-6",
				default_with_video: "6.4e-6",
				"1080p_without_video": "11.7e-6",
				"1080p_with_video": "7e-6",
			},
		],
		[
			"seedance-2-0",
			{
				default_without_video: "7e-6",
				default_with_video: "4.3e-6",
				"1080p_without_video": "7.7e-6",
				"1080p_with_video": "4.7e-6",
				"4k_without_video": "4e-6",
				"4k_with_video": "2.4e-6",
			},
		],
		[
			"seedance-2-0-fast",
			{ default_without_video: "5.6e-6", default_with_video: "3.3e-6" },
		],
		[
			"seedance-2-0-mini",
			{ default_without_video: "3.5e-6", default_with_video: "2.1e-6" },
		],
		["seedance-1-5-pro", { default_audio: "2.4e-6", default_video: "1.2e-6" }],
	])("declares exact token rates for %s", (id, prices) => {
		expect(mapping(id as string).videoOutputPrice).toEqual(prices);
	});

	test("keeps per-second figures as unrounded no-video estimates", () => {
		expect(mapping("seedance-2-5").perSecondPrice).toMatchObject({
			default_audio: "0.23112",
			"480p_audio": "0.10280025",
			"1080p_audio": "0.56862",
		});
		expect(mapping("seedance-2-0").perSecondPrice?.["1080p_audio"]).toBe(
			"0.37422",
		);
		expect(mapping("seedance-2-0-fast").perSecondPrice).toEqual({
			default_audio: "0.12096",
			default_video: "0.12096",
		});
		expect(mapping("seedance-2-0-mini").perSecondPrice?.["480p_audio"]).toBe(
			"0.035154",
		);
		expect(mapping("seedance-1-5-pro").perSecondPrice?.["1080p_audio"]).toBe(
			"0.11664",
		);
	});

	test("retires Seedance 1.5 Pro on the announced date", () => {
		expect(mapping("seedance-1-5-pro").deactivatedAt).toEqual(
			new Date("2026-11-11"),
		);
	});
});
