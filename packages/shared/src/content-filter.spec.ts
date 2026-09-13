import { describe, expect, test } from "vitest";

import {
	DEFAULT_CONTENT_FILTER_SETTINGS,
	isContentFilterErrorText,
	parseContentFilterSettings,
} from "./content-filter.js";

describe("parseContentFilterSettings", () => {
	test("defaults to log-only sampling with no providers", () => {
		expect(DEFAULT_CONTENT_FILTER_SETTINGS).toEqual({
			enabled: true,
			providerIds: [],
			sampleRatePercent: 100,
			enforce: false,
			enforceEnterprise: false,
		});
		expect(parseContentFilterSettings(null)).toEqual(
			DEFAULT_CONTENT_FILTER_SETTINGS,
		);
		expect(parseContentFilterSettings("not json")).toEqual(
			DEFAULT_CONTENT_FILTER_SETTINGS,
		);
	});

	test("parses stored settings and fills missing fields", () => {
		expect(
			parseContentFilterSettings(
				JSON.stringify({ providerIds: ["openai"], sampleRatePercent: 10 }),
			),
		).toEqual({
			enabled: true,
			providerIds: ["openai"],
			sampleRatePercent: 10,
			enforce: false,
			enforceEnterprise: false,
		});
	});

	test("falls back to defaults on out-of-range values", () => {
		expect(
			parseContentFilterSettings(JSON.stringify({ sampleRatePercent: 250 })),
		).toEqual(DEFAULT_CONTENT_FILTER_SETTINGS);
	});
});

describe("isContentFilterErrorText", () => {
	test("detects ByteDance Seedance video output moderation", () => {
		expect(
			isContentFilterErrorText("OutputVideoSensitiveContentDetected"),
		).toBe(true);
		expect(
			isContentFilterErrorText(
				"OutputVideoSensitiveContentDetected.PolicyViolation: the output video may be related to copyright restrictions",
			),
		).toBe(true);
	});

	test("detects other provider moderation signals", () => {
		expect(isContentFilterErrorText("ResponsibleAIPolicyViolation")).toBe(true);
		expect(isContentFilterErrorText("data_inspection_failed")).toBe(true);
		expect(
			isContentFilterErrorText(
				"Your request was rejected by the safety system",
			),
		).toBe(true);
		expect(
			isContentFilterErrorText(
				"Blocked by Microsoft's content management policy",
			),
		).toBe(true);
	});

	test("detects Alibaba DashScope Wan green-net moderation", () => {
		expect(
			isContentFilterErrorText("Green net check failed for input text"),
		).toBe(true);
	});

	test("detects xAI video moderation", () => {
		expect(
			isContentFilterErrorText(
				'{"code":"imagine:content-moderated","error":"Generated video rejected by content moderation."}',
			),
		).toBe(true);
	});

	test("detects Z.AI / Zhipu GLM content moderation (code 1301)", () => {
		expect(
			isContentFilterErrorText(
				"System detected potentially unsafe or sensitive content in input or generation. Please avoid using prompts that may generate sensitive content.",
			),
		).toBe(true);
	});

	test("returns false for generic upstream errors and empty input", () => {
		expect(isContentFilterErrorText("Internal server error")).toBe(false);
		expect(isContentFilterErrorText("the task id was not found")).toBe(false);
		expect(isContentFilterErrorText(null)).toBe(false);
		expect(isContentFilterErrorText(undefined)).toBe(false);
		expect(isContentFilterErrorText("")).toBe(false);
	});
});
