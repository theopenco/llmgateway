import { describe, expect, it } from "vitest";

import { parseModelInput } from "./parse-model-input.js";
import { resolveModelInfo } from "./resolve-model-info.js";

describe("parseModelInput / resolveModelInfo free vs paid sibling", () => {
	// A free catalog entry and its paid sibling can share the same upstream
	// externalId (e.g. claude-haiku-4-5-free and claude-haiku-4-5 both map to
	// externalId "claude-haiku-4-5"). Routing must preserve the catalog id so the
	// free entry never resolves to the paid one.
	it("preserves the free catalog id for the provider-prefixed form", () => {
		const result = parseModelInput("anthropic/claude-haiku-4-5-free");
		expect(result.requestedModel).toBe("claude-haiku-4-5-free");
		expect(result.requestedProvider).toBe("anthropic");
	});

	it("preserves the paid catalog id for the provider-prefixed form", () => {
		const result = parseModelInput("anthropic/claude-haiku-4-5");
		expect(result.requestedModel).toBe("claude-haiku-4-5");
		expect(result.requestedProvider).toBe("anthropic");
	});

	it("resolves the free entry, not the paid sibling", () => {
		const { requestedModel, requestedProvider } = parseModelInput(
			"anthropic/claude-haiku-4-5-free",
		);
		const { modelInfo } = resolveModelInfo(requestedModel, requestedProvider);
		expect(modelInfo.id).toBe("claude-haiku-4-5-free");
		expect("free" in modelInfo && modelInfo.free).toBe(true);
	});

	it("resolves the paid entry for the paid catalog id", () => {
		const { requestedModel, requestedProvider } = parseModelInput(
			"anthropic/claude-haiku-4-5",
		);
		const { modelInfo } = resolveModelInfo(requestedModel, requestedProvider);
		expect(modelInfo.id).toBe("claude-haiku-4-5");
		expect("free" in modelInfo && modelInfo.free).toBeFalsy();
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
