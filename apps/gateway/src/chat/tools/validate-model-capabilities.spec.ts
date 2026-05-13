import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import { validateModelCapabilities } from "./validate-model-capabilities.js";

import type { ModelDefinition } from "@llmgateway/models";

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
