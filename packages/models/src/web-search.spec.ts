import { describe, expect, test } from "vitest";

import { getProviderDefinition, type ProviderDefinition } from "./providers.js";
import {
	formatWebSearchEngine,
	getWebSearchEngineComplianceFailures,
	getWebSearchEngineDataPolicy,
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

test("isGatewayWebSearch reads the logged search type", () => {
	expect(isGatewayWebSearch("gateway")).toBe(true);
	expect(isGatewayWebSearch("native")).toBe(false);
	expect(isGatewayWebSearch(null)).toBe(false);
});

test("formatWebSearchEngine names gateway engines and providers", () => {
	expect(formatWebSearchEngine("exa")).toBe("Exa");
	expect(formatWebSearchEngine("perplexity")).toBe("Perplexity");
	expect(formatWebSearchEngine("not-a-provider")).toBe("not-a-provider");
});

describe("web search engine compliance", () => {
	test("a disabled policy allows every engine", () => {
		expect(
			getWebSearchEngineComplianceFailures("exa", { enabled: false }),
		).toEqual([]);
	});

	test("Perplexity search follows the Perplexity provider", () => {
		const policy = { enabled: true, blockedProviders: ["perplexity"] };
		expect(getWebSearchEngineComplianceFailures("perplexity", policy)).toEqual([
			"blockedProviders",
		]);
		expect(
			getWebSearchEngineComplianceFailures("perplexity", {
				enabled: true,
				blockApiTraining: true,
				requireSoc2Type2: true,
				allowedCountries: ["US"],
			}),
		).toEqual([]);
		expect(
			getWebSearchEngineComplianceFailures("perplexity", {
				enabled: true,
				zeroDataRetention: true,
			}),
		).toEqual(["zeroDataRetention"]);
	});

	test("Perplexity search uses the effective provider definition", () => {
		const perplexity = getProviderDefinition("perplexity")!;
		const providers: ProviderDefinition[] = [
			{ ...perplexity, headquarters: "DE" },
		];
		expect(getWebSearchEngineDataPolicy("perplexity", providers)).toEqual({
			dataPolicy: perplexity.dataPolicy,
			headquarters: "DE",
		});
		expect(
			getWebSearchEngineComplianceFailures(
				"perplexity",
				{ enabled: true, allowedCountries: ["US"] },
				providers,
			),
		).toEqual(["allowedCountries"]);
	});

	test("Exa is checked by its own data policy and engine id", () => {
		expect(
			getWebSearchEngineComplianceFailures("exa", {
				enabled: true,
				blockApiTraining: true,
				zeroDataRetention: true,
			}),
		).toEqual(["blockApiTraining", "zeroDataRetention"]);
		expect(
			getWebSearchEngineComplianceFailures("exa", {
				enabled: true,
				requireSoc2Type2: true,
				requireGdpr: true,
				allowedCountries: ["US"],
			}),
		).toEqual([]);
		expect(
			getWebSearchEngineComplianceFailures("exa", {
				enabled: true,
				blockedProviders: ["exa"],
			}),
		).toEqual(["blockedProviders"]);
		expect(
			getWebSearchEngineComplianceFailures("exa", {
				enabled: true,
				allowedProviders: ["openai"],
			}),
		).toEqual(["allowedProviders"]);
	});
});
