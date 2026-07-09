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
