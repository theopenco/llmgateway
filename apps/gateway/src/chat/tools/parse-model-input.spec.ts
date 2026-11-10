import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseModelInput } from "./parse-model-input.js";
import { resolveModelInfo } from "./resolve-model-info.js";

import type { Model } from "@llmgateway/models";

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

describe("resolveModelInfo deactivated provider pins", () => {
	// google-ai-studio is deactivated on 2026-01-17, google-vertex on 2026-01-27.
	afterEach(() => {
		vi.useRealTimers();
	});

	it("rejects a pin to a deactivated mapping with 410 instead of rerouting", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-01-20T12:00:00Z"));
		let error: unknown;
		try {
			resolveModelInfo(
				"gemini-2.5-flash-preview-09-2025" as Model,
				"google-ai-studio",
			);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(HTTPException);
		expect((error as HTTPException).status).toBe(410);
		expect((error as HTTPException).message).toContain(
			"Provider google-ai-studio no longer serves model gemini-2.5-flash-preview-09-2025",
		);
	});

	it("keeps routing an unpinned request to the active mappings", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-01-20T12:00:00Z"));
		const { modelInfo, requestedProvider } = resolveModelInfo(
			"gemini-2.5-flash-preview-09-2025" as Model,
			undefined,
		);
		expect(requestedProvider).toBeUndefined();
		expect(modelInfo.providers.map((p) => p.providerId)).not.toContain(
			"google-ai-studio",
		);
		expect(modelInfo.providers.map((p) => p.providerId)).toContain(
			"google-vertex",
		);
	});
});

describe("parseModelInput virtual aliases", () => {
	it("routes a bare virtual alias to its current cut", () => {
		const result = parseModelInput("deepseek-v4.1-flash-latest");
		expect(result.requestedModel).toBe("deepseek-v4.1-flash-1017");
		expect(result.requestedProvider).toBeUndefined();
		expect(
			resolveModelInfo(result.requestedModel, result.requestedProvider)
				.modelInfo.id,
		).toBe("deepseek-v4.1-flash-1017");
	});

	it("routes a provider-prefixed virtual alias to its current cut", () => {
		const result = parseModelInput("tencent/deepseek-v4.1-flash-latest");
		expect(result.requestedModel).toBe("deepseek-v4.1-flash-1017");
		expect(result.requestedProvider).toBe("tencent");
	});

	it("keeps rejecting a provider that does not serve the alias target", () => {
		expect(() => parseModelInput("openai/deepseek-v4.1-flash-latest")).toThrow(
			/does not support/,
		);
	});

	it("does not route non-virtual search aliases", () => {
		expect(() => parseModelInput("nano banana")).toThrow(/not supported/);
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
			expect(httpError.message).toContain("configured name");
			expect(httpError.message).toContain('e.g. "acme/acme-large"');
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
			expect(httpError.message).toContain('e.g. "my-provider/model-name"');
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

	it("rejects custom models without a custom provider name", () => {
		expect(() => parseModelInput("custom/gpt-4o-mini")).toThrow(
			/configured name/,
		);
		expect(() => parseModelInput("/gpt-4o-mini")).toThrow(/configured name/);
	});
});

describe("retired canonical aliases", () => {
	it.each([
		"deepseek-v4-flash",
		"alibaba/deepseek-v4-flash",
		"alibaba/deepseek-v4-flash:singapore",
	])("routes %s to the replacement snapshot", (input) => {
		const result = parseModelInput(input);
		expect(result.requestedModel).toBe("deepseek-v4-flash-0731");
		expect(result.requestedProvider).toBe(
			input.includes("/") ? "alibaba" : undefined,
		);
		expect(result.requestedRegion).toBe(
			input.includes(":") ? "singapore" : undefined,
		);
	});
	it("keeps a Tencent pin on the replacement snapshot", () => {
		const result = parseModelInput("tencent/deepseek-v4-flash");
		expect(result.requestedModel).toBe("deepseek-v4-flash-0731");
		expect(result.requestedProvider).toBe("tencent");
	});
	it("rejects a legacy pin whose provider does not serve the replacement", () => {
		expect(() => parseModelInput("ranoai/deepseek-v4-flash")).toThrow(
			/does not support/,
		);
	});
});
