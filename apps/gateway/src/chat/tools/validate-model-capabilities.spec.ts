import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import { validateModelCapabilities } from "./validate-model-capabilities.js";

import type {
	ModelDefinition,
	ProviderModelMapping,
	ReasoningEffort,
} from "@llmgateway/models";

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

describe("validateModelCapabilities - reasoning effort allowlist", () => {
	const ALL_EFFORTS: ReasoningEffort[] = [
		"none",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	];

	const reasoningProviders = (m: ModelDefinition) =>
		(m.providers as ProviderModelMapping[]).filter((p) => p.reasoning === true);

	// A model where every reasoning-capable provider declares a non-empty
	// reasoningEfforts list AND at least one global tier is left out — lets us
	// pick both a supported and an unsupported effort deterministically.
	const declaredModel = (() => {
		for (const m of models as readonly ModelDefinition[]) {
			const rp = reasoningProviders(m);
			if (!rp.length) {
				continue;
			}
			if (!rp.every((p) => p.reasoningEfforts && p.reasoningEfforts.length)) {
				continue;
			}
			const union = new Set(rp.flatMap((p) => p.reasoningEfforts ?? []));
			if (ALL_EFFORTS.some((e) => !union.has(e))) {
				return m;
			}
		}
		throw new Error(
			"Test fixture missing: no reasoning model declares reasoningEfforts on all providers with a missing tier",
		);
	})();

	const declaredUnion = new Set(
		reasoningProviders(declaredModel).flatMap((p) => p.reasoningEfforts ?? []),
	);
	const supportedEffort = [...declaredUnion][0];
	const unsupportedEffort = ALL_EFFORTS.find((e) => !declaredUnion.has(e))!;
	const pinnedProvider = reasoningProviders(declaredModel)[0].providerId;

	// A reasoning model where at least one reasoning-capable provider declares no
	// list at all, so every effort must pass through untouched (never a gateway
	// 400 for a request that could have worked upstream).
	const undeclaredModel = (() => {
		for (const m of models as readonly ModelDefinition[]) {
			const rp = reasoningProviders(m);
			if (
				rp.length &&
				rp.some((p) => !p.reasoningEfforts || !p.reasoningEfforts.length)
			) {
				return m;
			}
		}
		throw new Error(
			"Test fixture missing: no reasoning model with an undeclared reasoningEfforts provider",
		);
	})();

	it("allows a declared effort value", () => {
		expect(() =>
			validateModelCapabilities(declaredModel, declaredModel.id, undefined, {
				reasoning_effort: supportedEffort,
			}),
		).not.toThrow();
	});

	it("rejects an effort value outside the declared list", () => {
		expect(() =>
			validateModelCapabilities(declaredModel, declaredModel.id, undefined, {
				reasoning_effort: unsupportedEffort,
			}),
		).toThrow(HTTPException);
	});

	it("tags the rejection with the unsupported_reasoning_effort cause", () => {
		try {
			validateModelCapabilities(declaredModel, declaredModel.id, undefined, {
				reasoning_effort: unsupportedEffort,
			});
			throw new Error("expected a rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(HTTPException);
			expect((error as HTTPException).cause).toBe(
				"unsupported_reasoning_effort",
			);
		}
	});

	it("rejects when the pinned provider excludes the effort", () => {
		expect(() =>
			validateModelCapabilities(
				declaredModel,
				declaredModel.id,
				pinnedProvider,
				{
					reasoning_effort: unsupportedEffort,
				},
			),
		).toThrow(HTTPException);
	});

	it("passes through any effort when no list is declared", () => {
		for (const effort of ALL_EFFORTS) {
			expect(() =>
				validateModelCapabilities(
					undeclaredModel,
					undeclaredModel.id,
					undefined,
					{
						reasoning_effort: effort,
					},
				),
			).not.toThrow();
		}
	});

	it("skips the effort allowlist for auto and custom models", () => {
		expect(() =>
			validateModelCapabilities(declaredModel, "auto", undefined, {
				reasoning_effort: unsupportedEffort,
			}),
		).not.toThrow();
		expect(() =>
			validateModelCapabilities(declaredModel, "custom", undefined, {
				reasoning_effort: unsupportedEffort,
			}),
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
});
