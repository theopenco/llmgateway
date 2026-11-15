import { describe, expect, test } from "vitest";

import {
	formatWebSearchEngine,
	isGatewayWebSearch,
	resolveGatewayWebSearchEngine,
	supportsWebSearch,
	usesGatewayWebSearch,
	webSearchListPrice,
} from "./web-search.js";

describe("usesGatewayWebSearch", () => {
	test("covers chat mappings without native search", () => {
		expect(usesGatewayWebSearch({})).toBe(true);
		expect(usesGatewayWebSearch({ webSearch: false })).toBe(true);
		expect(usesGatewayWebSearch({ webSearch: true })).toBe(false);
	});

	test("skips non-chat mappings", () => {
		for (const flag of [
			"imageGenerations",
			"videoGenerations",
			"embeddings",
			"speechGenerations",
			"realtime",
		] as const) {
			expect(usesGatewayWebSearch({ [flag]: true }), flag).toBe(false);
			expect(supportsWebSearch({ [flag]: true }), flag).toBe(false);
		}
	});

	test("webSearchListPrice", () => {
		expect(
			webSearchListPrice({ webSearch: true, webSearchPrice: "0.01" }),
		).toBe("0.01");
		expect(webSearchListPrice({})).toBe("0.005");
		expect(webSearchListPrice({ embeddings: true })).toBeUndefined();
	});

	test("supportsWebSearch is native or gateway-run", () => {
		expect(supportsWebSearch({ webSearch: true })).toBe(true);
		expect(supportsWebSearch({})).toBe(true);
	});
});

test("resolveGatewayWebSearchEngine falls back to the default", () => {
	expect(resolveGatewayWebSearchEngine("exa")).toBe("exa");
	expect(resolveGatewayWebSearchEngine(null)).toBe("perplexity");
	expect(resolveGatewayWebSearchEngine("unknown")).toBe("perplexity");
});

test("isGatewayWebSearch is native when the provider ran the search", () => {
	expect(isGatewayWebSearch("perplexity", "deepinfra")).toBe(true);
	expect(isGatewayWebSearch("openai", "openai")).toBe(false);
	expect(isGatewayWebSearch(null, "openai")).toBe(false);
});

test("formatWebSearchEngine names gateway engines and providers", () => {
	expect(formatWebSearchEngine("exa")).toBe("Exa");
	expect(formatWebSearchEngine("perplexity")).toBe("Perplexity");
	expect(formatWebSearchEngine("not-a-provider")).toBe("not-a-provider");
});
