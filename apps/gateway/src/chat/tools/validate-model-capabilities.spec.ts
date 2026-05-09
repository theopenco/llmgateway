import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { validateModelCapabilities } from "./validate-model-capabilities.js";

import type { ModelDefinition } from "@llmgateway/models";

const noVisionModel: ModelDefinition = {
	id: "deepseek-v4-flash",
	name: "DeepSeek V4 Flash",
	family: "deepseek",
	providers: [
		{
			providerId: "deepseek",
			modelName: "deepseek-v4-flash",
			inputPrice: 0,
			outputPrice: 0,
			contextSize: 1000,
			streaming: true,
			vision: false,
			tools: true,
		},
		{
			providerId: "novita",
			modelName: "deepseek/deepseek-v4-flash",
			inputPrice: 0,
			outputPrice: 0,
			contextSize: 1000,
			streaming: true,
			vision: false,
			tools: true,
		},
	],
} as ModelDefinition;

const mixedVisionModel: ModelDefinition = {
	id: "mixed-model",
	name: "Mixed",
	family: "test",
	providers: [
		{
			providerId: "deepseek",
			modelName: "x",
			inputPrice: 0,
			outputPrice: 0,
			contextSize: 1000,
			streaming: true,
			vision: false,
			tools: true,
		},
		{
			providerId: "openai",
			modelName: "x",
			inputPrice: 0,
			outputPrice: 0,
			contextSize: 1000,
			streaming: true,
			vision: true,
			tools: true,
		},
	],
} as ModelDefinition;

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
			validateModelCapabilities(mixedVisionModel, "mixed-model", undefined, {
				hasImages: true,
			}),
		).not.toThrow();
	});

	it("allows when explicit provider supports vision", () => {
		expect(() =>
			validateModelCapabilities(mixedVisionModel, "mixed-model", "openai", {
				hasImages: true,
			}),
		).not.toThrow();
	});

	it("rejects when explicit non-vision provider is picked even if a sibling has vision", () => {
		expect(() =>
			validateModelCapabilities(mixedVisionModel, "mixed-model", "deepseek", {
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
