import { afterEach, describe, expect, test } from "vitest";

import { getProviderEndpoint } from "./get-provider-endpoint.js";

const originalGlacierBaseUrl = process.env.LLM_GLACIER_BASE_URL;

afterEach(() => {
	if (originalGlacierBaseUrl === undefined) {
		delete process.env.LLM_GLACIER_BASE_URL;
		return;
	}

	process.env.LLM_GLACIER_BASE_URL = originalGlacierBaseUrl;
});

describe("getProviderEndpoint", () => {
	test("builds Glacier endpoints from env base URL", () => {
		process.env.LLM_GLACIER_BASE_URL = "https://glacier.example.com";

		const endpoint = getProviderEndpoint(
			"glacier",
			undefined,
			"gemini-2.5-pro",
			"glacier-key",
			true,
		);

		expect(endpoint).toBe(
			"https://glacier.example.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?key=glacier-key&alt=sse",
		);
	});

	test("requires Glacier base URL when no override is provided", () => {
		delete process.env.LLM_GLACIER_BASE_URL;

		expect(() => getProviderEndpoint("glacier")).toThrow(
			"Glacier provider requires LLM_GLACIER_BASE_URL environment variable",
		);
	});
});
