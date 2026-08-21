import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import { validateModelCapabilities } from "./validate-model-capabilities.js";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

function getModel(id: string): ModelDefinition {
	const m = models.find((model) => model.id === id);
	if (!m) {
		throw new Error(
			`Test fixture missing: model "${id}" not found in registry`,
		);
	}
	return m as ModelDefinition;
}

// deepseek-v4-flash will not gain vision support upstream, so it's a stable
// fixture for "no provider supports vision".
const noVisionModel = getModel("deepseek-v4-flash");

// qwen3-max has alibaba (vision: true) alongside novita/embercloud
// (vision: false), giving us a mixed-capability fixture.
const mixedVisionModel = getModel("qwen3-max");

const embeddingModel = getModel("text-embedding-3-small");

// Pick a stable fixture for each single-output capability straight from the
// registry so the tests don't pin to a specific model id that may churn.
function getModelByOutput(output: string): ModelDefinition {
	const m = (models as readonly ModelDefinition[]).find(
		(model) =>
			Array.isArray(model.output) &&
			model.output.length === 1 &&
			model.output[0] === output,
	);
	if (!m) {
		throw new Error(`Test fixture missing: no model with output ["${output}"]`);
	}
	return m;
}

const ocrModel = getModelByOutput("ocr");
const videoModel = getModelByOutput("video");
const audioModel = getModelByOutput("audio");
const imageOnlyModel = getModelByOutput("image");
const textImageModel = (() => {
	const m = (models as readonly ModelDefinition[]).find(
		(model) =>
			Array.isArray(model.output) &&
			model.output.includes("text") &&
			model.output.includes("image"),
	);
	if (!m) {
		throw new Error(
			'Test fixture missing: no model with output ["text","image"]',
		);
	}
	return m;
})();

// gemma-4-31b-it has runware (supportsAssistantPrefill: false) alongside
// providers that accept a trailing assistant message.
const mixedPrefillModel = getModel("gemma-4-31b-it");

// JSON capability fixtures — looked up by capability combination so the tests
// don't pin to a specific model id that may churn. Only chat-servable models
// (text/image output) qualify; the "auto"/"custom" sentinel entries are
// excluded.
function getModelByJsonCapability(
	kind: "none" | "soft" | "strict",
): ModelDefinition {
	const isChat = (m: ModelDefinition) =>
		(m.output ?? ["text"]).some((o) => o === "text" || o === "image");
	const m = (models as readonly ModelDefinition[]).find((model) => {
		if (!isChat(model) || model.id === "auto" || model.id === "custom") {
			return false;
		}
		const soft = model.providers.some(
			(p) => (p as ProviderModelMapping).jsonOutput === true,
		);
		const strict = model.providers.some(
			(p) => (p as ProviderModelMapping).jsonOutputSchema === true,
		);
		return kind === "none"
			? !soft && !strict
			: kind === "soft"
				? soft && !strict
				: strict;
	});
	if (!m) {
		throw new Error(
			`Test fixture missing: no model with JSON capability "${kind}"`,
		);
	}
	return m;
}

describe("validateModelCapabilities - assistant prefill", () => {
	it("rejects when the explicit provider rejects a trailing assistant message", () => {
		expect(() =>
			validateModelCapabilities(
				mixedPrefillModel,
				"gemma-4-31b-it",
				"runware",
				{ hasAssistantPrefill: true },
			),
		).toThrow(HTTPException);
	});

	it("allows when a sibling provider accepts a trailing assistant message", () => {
		expect(() =>
			validateModelCapabilities(
				mixedPrefillModel,
				"gemma-4-31b-it",
				undefined,
				{
					hasAssistantPrefill: true,
				},
			),
		).not.toThrow();
	});

	it("allows the same provider when the conversation does not end on an assistant turn", () => {
		expect(() =>
			validateModelCapabilities(
				mixedPrefillModel,
				"gemma-4-31b-it",
				"runware",
				{
					hasAssistantPrefill: false,
				},
			),
		).not.toThrow();
	});
});

describe("validateModelCapabilities - vision", () => {
	it("rejects when explicit provider does not support vision", () => {
		expect(() =>
			validateModelCapabilities(
				noVisionModel,
				"deepseek-v4-flash",
				"deepseek",
				{ hasImages: true },
			),
		).toThrow(HTTPException);
	});

	it("rejects when no provider in the model supports vision", () => {
		expect(() =>
			validateModelCapabilities(noVisionModel, "deepseek-v4-flash", undefined, {
				hasImages: true,
			}),
		).toThrow(HTTPException);
	});

	it("allows when at least one provider supports vision and no explicit provider", () => {
		expect(() =>
			validateModelCapabilities(mixedVisionModel, "qwen3-max", undefined, {
				hasImages: true,
			}),
		).not.toThrow();
	});

	it("allows when explicit provider supports vision", () => {
		expect(() =>
			validateModelCapabilities(mixedVisionModel, "qwen3-max", "alibaba", {
				hasImages: true,
			}),
		).not.toThrow();
	});

	it("rejects when explicit non-vision provider is picked even if a sibling has vision", () => {
		expect(() =>
			validateModelCapabilities(mixedVisionModel, "qwen3-max", "novita", {
				hasImages: true,
			}),
		).toThrow(HTTPException);
	});

	it("does not check vision when no images are present", () => {
		expect(() =>
			validateModelCapabilities(
				noVisionModel,
				"deepseek-v4-flash",
				"deepseek",
				{
					hasImages: false,
				},
			),
		).not.toThrow();
	});

	it("skips the vision check for auto and custom models", () => {
		expect(() =>
			validateModelCapabilities(noVisionModel, "auto", undefined, {
				hasImages: true,
			}),
		).not.toThrow();
		expect(() =>
			validateModelCapabilities(noVisionModel, "custom", undefined, {
				hasImages: true,
			}),
		).not.toThrow();
	});
});

describe("validateModelCapabilities - verbosity", () => {
	const verbosityModel = getModel("gpt-5.6-terra");

	it("allows verbosity for models that support it", () => {
		expect(() =>
			validateModelCapabilities(verbosityModel, "gpt-5.6-terra", undefined, {
				verbosity: "low",
			}),
		).not.toThrow();
	});

	it("allows verbosity for older GPT-5 models that support it", () => {
		const olderModel = getModel("gpt-5.1");
		expect(() =>
			validateModelCapabilities(olderModel, "gpt-5.1", undefined, {
				verbosity: "high",
			}),
		).not.toThrow();
	});

	it("rejects verbosity for models without support", () => {
		expect(() =>
			validateModelCapabilities(noVisionModel, "deepseek-v4-flash", undefined, {
				verbosity: "low",
			}),
		).toThrow(HTTPException);
	});

	it("skips the verbosity check for auto and custom models", () => {
		expect(() =>
			validateModelCapabilities(noVisionModel, "auto", undefined, {
				verbosity: "low",
			}),
		).not.toThrow();
		expect(() =>
			validateModelCapabilities(noVisionModel, "custom", undefined, {
				verbosity: "low",
			}),
		).not.toThrow();
	});

	it("does not check verbosity when it is not specified", () => {
		expect(() =>
			validateModelCapabilities(
				noVisionModel,
				"deepseek-v4-flash",
				undefined,
				{},
			),
		).not.toThrow();
	});
});

describe("validateModelCapabilities - custom providers", () => {
	it("skips all capability checks when the provider is custom", () => {
		expect(() =>
			validateModelCapabilities(noVisionModel, "qwen3.6-plus", "custom", {
				hasImages: true,
				hasDocuments: true,
				response_format: { type: "json_object" },
				reasoning_effort: "high",
				tools: [{ type: "function" }],
			}),
		).not.toThrow();
	});
});

describe("validateModelCapabilities - embeddings", () => {
	it("rejects embedding-only models on chat completions", () => {
		expect(() =>
			validateModelCapabilities(
				embeddingModel,
				"text-embedding-3-small",
				undefined,
				{},
			),
		).toThrow(HTTPException);
	});

	it("rejects embedding-only models even with explicit provider", () => {
		expect(() =>
			validateModelCapabilities(
				embeddingModel,
				"text-embedding-3-small",
				"openai",
				{},
			),
		).toThrow(HTTPException);
	});

	it("does not reject regular chat models", () => {
		expect(() =>
			validateModelCapabilities(
				noVisionModel,
				"deepseek-v4-flash",
				undefined,
				{},
			),
		).not.toThrow();
	});

	it("skips the embedding check for auto and custom models", () => {
		expect(() =>
			validateModelCapabilities(embeddingModel, "auto", undefined, {}),
		).not.toThrow();
		expect(() =>
			validateModelCapabilities(embeddingModel, "custom", undefined, {}),
		).not.toThrow();
	});
});

describe("validateModelCapabilities - output capability", () => {
	it("rejects OCR models on chat completions", () => {
		expect(() =>
			validateModelCapabilities(ocrModel, ocrModel.id, undefined, {}),
		).toThrow(HTTPException);
	});

	it("rejects video models on chat completions", () => {
		expect(() =>
			validateModelCapabilities(videoModel, videoModel.id, undefined, {}),
		).toThrow(HTTPException);
	});

	it("rejects audio (speech) models on chat completions", () => {
		expect(() =>
			validateModelCapabilities(audioModel, audioModel.id, undefined, {}),
		).toThrow(HTTPException);
	});

	it("allows image-output models (image generation routes through chat)", () => {
		expect(() =>
			validateModelCapabilities(
				imageOnlyModel,
				imageOnlyModel.id,
				undefined,
				{},
			),
		).not.toThrow();
		expect(() =>
			validateModelCapabilities(
				textImageModel,
				textImageModel.id,
				undefined,
				{},
			),
		).not.toThrow();
	});
	describe("search-on-demand-only web search", () => {
		// Every mapping on qwen3.8-max is DashScope-backed, so the model has no
		// model-elected search anywhere to fall back to. Offering the tool is
		// still a valid request: the caller gets an ordinary unsearched answer,
		// exactly as they would from a model that chose not to search.
		const forcedOnlyModel = getModel("qwen3.8-max");

		it("accepts a merely offered web_search tool", () => {
			expect(() =>
				validateModelCapabilities(forcedOnlyModel, "qwen3.8-max", "alibaba", {
					// Extraction pulls web_search out of `tools`, leaving it empty.
					tools: [],
					webSearchTool: { type: "web_search" },
				}),
			).not.toThrow();
		});

		it("accepts a forced web_search tool", () => {
			expect(() =>
				validateModelCapabilities(forcedOnlyModel, "qwen3.8-max", "alibaba", {
					tools: [],
					webSearchTool: { type: "web_search", forced: true },
				}),
			).not.toThrow();
		});
	});
});

describe("validateModelCapabilities - reasoning.max_tokens", () => {
	const lingModel = getModel("ling-3.0-flash");
	const nonBudgetModel = getModel("gpt-4o-mini");

	it("rejects reasoning.max_tokens for models with no budget support", () => {
		expect(() =>
			validateModelCapabilities(nonBudgetModel, nonBudgetModel.id, undefined, {
				reasoning_max_tokens: 2048,
			}),
		).toThrow(HTTPException);
	});

	it("allows reasoning.max_tokens on chatTemplateThinkingKey mappings (budget is dropped to a binary toggle)", () => {
		expect(() =>
			validateModelCapabilities(lingModel, lingModel.id, undefined, {
				reasoning_max_tokens: 2048,
			}),
		).not.toThrow();
	});

	it("rejects reasoning.max_tokens on a provider with no thinking control (thinking is always on)", () => {
		// Novita's Ling mapping has no chatTemplateThinkingKey and no
		// reasoningMaxTokens — its backend ignores the chat-template flag, so a
		// budget request is rejected rather than silently accepted.
		expect(() =>
			validateModelCapabilities(lingModel, lingModel.id, "novita", {
				reasoning_max_tokens: 2048,
			}),
		).toThrow(HTTPException);
	});
});

describe("validateModelCapabilities - JSON output", () => {
	it("rejects json_object for a model without jsonOutput", () => {
		const m = getModelByJsonCapability("none");
		expect(() =>
			validateModelCapabilities(m, m.id, undefined, {
				response_format: { type: "json_object" },
			}),
		).toThrow(/does not support JSON output mode/);
	});

	it("accepts json_object for a soft-only model (jsonOutput true, schema false)", () => {
		const m = getModelByJsonCapability("soft");
		expect(() =>
			validateModelCapabilities(m, m.id, undefined, {
				response_format: { type: "json_object" },
			}),
		).not.toThrow();
	});

	it("rejects json_schema for a soft-only model — the gateway never emulates strict schema", () => {
		const m = getModelByJsonCapability("soft");
		expect(() =>
			validateModelCapabilities(m, m.id, undefined, {
				response_format: { type: "json_schema" },
			}),
		).toThrow(/does not support JSON schema output mode/);
	});

	it("accepts json_schema for a model with jsonOutputSchema true", () => {
		const m = getModelByJsonCapability("strict");
		expect(() =>
			validateModelCapabilities(m, m.id, undefined, {
				response_format: { type: "json_schema" },
			}),
		).not.toThrow();
	});

	it("rejects json_schema when the pinned provider is soft-only even if a sibling mapping is strict", () => {
		// gpt-4o: openai is strict, azure is soft-only. The contract is
		// per mapping, so pinning the soft-only provider must reject json_schema.
		const m = getModel("gpt-4o");
		expect(() =>
			validateModelCapabilities(m, "gpt-4o", "azure", {
				response_format: { type: "json_schema" },
			}),
		).toThrow(/does not support JSON schema output mode/);
		expect(() =>
			validateModelCapabilities(m, "gpt-4o", "openai", {
				response_format: { type: "json_schema" },
			}),
		).not.toThrow();
	});

	it("accepts json_schema when pinning azure gpt-4o-mini (azure supports structured outputs)", () => {
		const m = getModel("gpt-4o-mini");
		expect(() =>
			validateModelCapabilities(m, "gpt-4o-mini", "azure", {
				response_format: { type: "json_schema" },
			}),
		).not.toThrow();
	});
});
