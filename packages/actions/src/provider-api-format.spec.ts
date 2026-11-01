import { describe, expect, it } from "vitest";

import {
	getProviderApiTransport,
	getRequestApiFormat,
	getUpstreamModelId,
} from "./provider-api-format.js";

describe("getProviderApiTransport", () => {
	it("sends anthropic-messages through the Anthropic transport", () => {
		expect(getProviderApiTransport("deepseek", "anthropic-messages")).toBe(
			"anthropic",
		);
		expect(getProviderApiTransport("deepseek", "openai-responses")).toBe(
			"openai",
		);
		expect(getProviderApiTransport("deepseek", undefined)).toBe("deepseek");
	});
});

describe("getRequestApiFormat", () => {
	const mapping = { webSearchApiFormat: "openai-responses" as const };

	it("switches to webSearchApiFormat only for web search requests", () => {
		expect(getRequestApiFormat(mapping, true)).toBe("openai-responses");
		expect(getRequestApiFormat(mapping, false)).toBeUndefined();
	});

	it("keeps apiFormat without a webSearchApiFormat", () => {
		expect(
			getRequestApiFormat({ apiFormat: "openai-chat-completions" }, true),
		).toBe("openai-chat-completions");
		expect(getRequestApiFormat(undefined, true)).toBeUndefined();
	});
});

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
