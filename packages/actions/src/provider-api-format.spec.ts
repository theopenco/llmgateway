import { describe, expect, it } from "vitest";

import { getUpstreamModelId } from "./provider-api-format.js";

describe("getUpstreamModelId", () => {
	it.each([
		{ region: undefined, expected: "global.xai.grok-4.6" },
		{ region: "global", expected: "global.xai.grok-4.6" },
		{ region: "us", expected: "us.xai.grok-4.6" },
		{ region: "us-west-2", expected: "xai.grok-4.6" },
	])(
		"addresses a Bedrock cross-region profile mapping as $expected for $region",
		({ region, expected }) => {
			expect(
				getUpstreamModelId("aws-bedrock", "grok-4-6", "xai.grok-4.6", region),
			).toBe(expected);
		},
	);

	it("keeps the bare id for a Mantle-only Bedrock mapping", () => {
		expect(
			getUpstreamModelId("aws-bedrock", "grok-4-3", "xai.grok-4.3", "global"),
		).toBe("xai.grok-4.3");
	});

	it("leaves Converse and other providers untouched", () => {
		expect(
			getUpstreamModelId(
				"aws-bedrock",
				"claude-opus-5",
				"anthropic.claude-opus-5",
				"us",
			),
		).toBe("anthropic.claude-opus-5");
		expect(getUpstreamModelId("xai", "grok-4-6", "grok-4.6", undefined)).toBe(
			"grok-4.6",
		);
	});
});
