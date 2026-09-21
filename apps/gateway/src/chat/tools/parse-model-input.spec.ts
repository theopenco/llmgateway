import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { parseModelInput } from "./parse-model-input.js";
import { resolveModelInfo } from "./resolve-model-info.js";

describe("parseModelInput / resolveModelInfo catalog-id-only routing", () => {
	// Routing must carry the canonical catalog id, never the upstream externalId.
	// Two catalog entries can share an externalId (e.g. a free and a paid
	// sibling), so collapsing to the externalId would let resolution pick the
	// wrong entry. The upstream externalId is derived later from the selected
	// provider mapping.
	it("preserves the catalog id for the provider-prefixed form", () => {
		const result = parseModelInput("anthropic/claude-haiku-4-5");
		expect(result.requestedModel).toBe("claude-haiku-4-5");
		expect(result.requestedProvider).toBe("anthropic");
	});

	it("resolves the requested catalog entry strictly by id", () => {
		const { requestedModel, requestedProvider } = parseModelInput(
			"anthropic/claude-haiku-4-5",
		);
		const { modelInfo } = resolveModelInfo(requestedModel, requestedProvider);
		expect(modelInfo.id).toBe("claude-haiku-4-5");
	});

	it("still resolves a non-colliding model unchanged", () => {
		const { requestedModel, requestedProvider } =
			parseModelInput("openai/gpt-4o-mini");
		expect(requestedModel).toBe("gpt-4o-mini");
		const { modelInfo } = resolveModelInfo(requestedModel, requestedProvider);
		expect(modelInfo.id).toBe("gpt-4o-mini");
	});

	// Strict catalog-id-only routing: the provider/externalId form (upstream id)
	// is no longer accepted — callers must use the catalog id.
	it("rejects the provider/externalId form", () => {
		expect(() => parseModelInput("together-ai/zai-org/GLM-5.1")).toThrow();
	});

	it("accepts the canonical provider/catalog-id form", () => {
		const result = parseModelInput("together-ai/glm-5.1");
		expect(result.requestedModel).toBe("glm-5.1");
		expect(result.requestedProvider).toBe("together-ai");
	});
});

describe("parseModelInput legacy custom/ prefix", () => {
	// "custom" is a catalogue provider id, so "custom/<name>/<model>" used to
	// parse with requestedProvider "custom" but no customProviderName, skipping
	// the "Provider not found" guard and routing to an arbitrary custom key.
	it("rejects custom/<name>/<model> with a 400 pointing at <name>/<model>", () => {
		try {
			parseModelInput("custom/acme/acme-large");
			expect.unreachable("expected parseModelInput to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(HTTPException);
			const httpError = error as HTTPException;
			expect(httpError.status).toBe(400);
			expect(httpError.message).toContain('"<name>/<model>"');
			expect(httpError.message).toContain('"acme/acme-large"');
		}
	});

	it("rejects custom/<model> without suggesting a malformed rewrite", () => {
		try {
			parseModelInput("custom/some-model");
			expect.unreachable("expected parseModelInput to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(HTTPException);
			const httpError = error as HTTPException;
			expect(httpError.status).toBe(400);
			expect(httpError.message).toContain('"<name>/<model>"');
			expect(httpError.message).not.toContain('"some-model"');
		}
	});

	it('still accepts the bare "custom" model', () => {
		const result = parseModelInput("custom");
		expect(result.requestedProvider).toBe("llmgateway");
		expect(result.requestedModel).toBe("custom");
	});

	it("still resolves <name>/<model> as a custom provider", () => {
		const result = parseModelInput("acme/acme-large");
		expect(result.requestedProvider).toBe("custom");
		expect(result.customProviderName).toBe("acme");
		expect(result.requestedModel).toBe("acme-large");
	});
});

describe("parseModelInput dynamic routes", () => {
	it("tags a dynamic route and defers to the auto placeholder", () => {
		const result = parseModelInput("dynamic/support");
		expect(result.dynamicRouteName).toBe("support");
		expect(result.requestedModel).toBe("auto");
		expect(result.requestedProvider).toBe("llmgateway");
		expect(result.customProviderName).toBeUndefined();
		expect(result.requestedRegion).toBeUndefined();
	});

	it("rejects invalid dynamic route names", () => {
		expect(() => parseModelInput("dynamic/Bad_Name")).toThrow();
		expect(() => parseModelInput("dynamic/")).toThrow();
		expect(() => parseModelInput("dynamic/a--b")).toThrow();
	});

	it("does not tag ordinary provider-prefixed models", () => {
		const result = parseModelInput("openai/gpt-4o-mini");
		expect(result.dynamicRouteName).toBeUndefined();
	});
});
