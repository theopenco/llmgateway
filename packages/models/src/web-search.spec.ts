import { describe, expect, test } from "vitest";

import { models } from "./models.js";
import {
	DEFAULT_GATEWAY_WEB_SEARCH_ENGINE,
	GATEWAY_WEB_SEARCH_ENGINES,
	formatWebSearchEngine,
	isGatewayWebSearch,
	resolveGatewayWebSearchEngine,
} from "./web-search.js";

import type { ProviderModelMapping } from "./models.js";

describe("gateway web search mappings", () => {
	const mappings = models.flatMap((m) =>
		(m.providers as ProviderModelMapping[])
			.filter((p) => p.gatewayWebSearch)
			.map((p) => ({ model: m.id, ...p })),
	);

	test("list web search and the default engine's price", () => {
		expect(mappings.length).toBeGreaterThan(0);
		for (const p of mappings) {
			expect(p.webSearch, `${p.providerId}/${p.model}`).toBe(true);
			expect(p.webSearchPrice, `${p.providerId}/${p.model}`).toBe(
				GATEWAY_WEB_SEARCH_ENGINES[DEFAULT_GATEWAY_WEB_SEARCH_ENGINE].price,
			);
		}
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
