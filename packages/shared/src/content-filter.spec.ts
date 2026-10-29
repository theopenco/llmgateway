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
			classifier: "openai",
			internalScope: "full",
			moderateImages: true,
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
			classifier: "openai",
			internalScope: "full",
			moderateImages: true,
		});
	});

	test("reads the internal classifier scope", () => {
		expect(
			parseContentFilterSettings(
				JSON.stringify({
					classifier: "internal",
					internalScope: "latest_turn",
				}),
			),
		).toMatchObject({ classifier: "internal", internalScope: "latest_turn" });
	});

	test("ignores the removed shadowClassifier field on stored settings", () => {
		expect(
			parseContentFilterSettings(
				JSON.stringify({ classifier: "jev", shadowClassifier: "openai" }),
			),
		).toEqual({ ...DEFAULT_CONTENT_FILTER_SETTINGS, classifier: "jev" });
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

	test("detects Azure prompt filtering regardless of policy owner or casing", () => {
		expect(
			isContentFilterErrorText(
				"The response was filtered due to the prompt triggering Azure OpenAI\u2019s content management policy.",
			),
		).toBe(true);
		expect(
			isContentFilterErrorText('"innererror": { "code": "ContentFiltered" }'),
		).toBe(true);
		expect(isContentFilterErrorText("responsibleaipolicyviolation")).toBe(true);
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

	test("detects OpenAI cybersecurity policy blocks", () => {
		expect(
			isContentFilterErrorText(
				'{"type":"error","error":{"type":"invalid_request","code":"cyber_policy","message":"This content was flagged for possible cybersecurity risk."}}',
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

describe("Mistral guardrail errors", () => {
	test("detects the provider's guardrail violation payload", () => {
		expect(
			isContentFilterErrorText(
				'{"object":"error","message":"Request blocked by guardrail policy","type":"guardrail_violation","param":null,"code":"1920","raw_status_code":403}',
			),
		).toBe(true);
	});
	test.each([
		'{"object":"error","message":"Forbidden","type":"permission_error","code":"1920","raw_status_code":403}',
		'{"object":"error","message":"Invalid API key","type":"authentication_error"}',
		'{"type":"permission_error","message":"Access to guardrail_violation is disabled"}',
		'{"type":"authentication_error","message":"guardrail_violation requires a valid API key"}',
		"guardrail_violation",
		"Access denied by policy",
		"Guardrail policy configuration is unavailable",
	])(
		"does not treat unrelated permission or policy errors as moderation: %s",
		(text) => {
			expect(isContentFilterErrorText(text)).toBe(false);
		},
	);
});

describe("structured guardrail types", () => {
	test.each([
		JSON.stringify({ type: "guardrail_violation" }, null, 2),
		JSON.stringify({ error: { type: "guardrail_violation" } }),
	])("matches the error type in JSON: %s", (text) => {
		expect(isContentFilterErrorText(text)).toBe(true);
	});
	test.each([
		JSON.stringify({ type: "permission_error", error: "guardrail_violation" }),
		JSON.stringify({ message: 'Expected type: "guardrail_violation"' }),
		'{"type":"guardrail_violation"',
		JSON.stringify(["guardrail_violation"]),
	])("ignores a token outside a parsed error type: %s", (text) => {
		expect(isContentFilterErrorText(text)).toBe(false);
	});
});
