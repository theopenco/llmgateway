import { describe, expect, test } from "vitest";

import { app } from "@/app.js";

describe("Models API", () => {
	test("GET /v1/models should return a list of models", async () => {
		const res = await app.request("/v1/models");

		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json).toHaveProperty("data");
		expect(Array.isArray(json.data)).toBe(true);
		expect(json.data.length).toBeGreaterThan(0);

		// Check the structure of the first model
		const firstModel = json.data[0];
		expect(firstModel).toHaveProperty("id");
		expect(firstModel).toHaveProperty("name");
		expect(firstModel).toHaveProperty("created");
		expect(firstModel).toHaveProperty("architecture");
		expect(firstModel.architecture).toHaveProperty("input_modalities");
		expect(firstModel.architecture).toHaveProperty("output_modalities");
		expect(firstModel).toHaveProperty("top_provider");

		expect(firstModel).toHaveProperty("providers");
		expect(Array.isArray(firstModel.providers)).toBe(true);
		expect(firstModel.providers.length).toBeGreaterThan(0);

		// Check the structure of the first provider
		const firstProvider = firstModel.providers[0];
		expect(firstProvider).toHaveProperty("providerId");
		expect(firstProvider).toHaveProperty("modelName");
		if (firstProvider.pricing) {
			expect(firstProvider.pricing).toHaveProperty("prompt");
			expect(firstProvider.pricing).toHaveProperty("completion");
		}

		expect(firstModel).toHaveProperty("pricing");
		expect(firstModel.pricing).toHaveProperty("prompt");
		expect(firstModel.pricing).toHaveProperty("completion");

		expect(firstModel).toHaveProperty("family");
	});

	test("GET /v1/models should exclude deactivated models by default", async () => {
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const json = await res.json();
		const currentDate = new Date();

		// Verify that no deactivated models are returned
		for (const model of json.data) {
			if (model.deactivated_at) {
				const deactivatedAt = new Date(model.deactivated_at);
				expect(currentDate <= deactivatedAt).toBe(true);
			}
		}
	});

	test("GET /v1/models?include_deactivated=true should include deactivated models", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json).toHaveProperty("data");
		expect(Array.isArray(json.data)).toBe(true);

		// The response should include all models (including deactivated ones)
		// We can't easily test this without knowing specific deactivated models,
		// but we can at least verify the endpoint works with the parameter
		expect(json.data.length).toBeGreaterThan(0);
	});

	test("GET /v1/models?exclude_deprecated=true should exclude deprecated models", async () => {
		const res = await app.request("/v1/models?exclude_deprecated=true");
		expect(res.status).toBe(200);

		const json = await res.json();
		const currentDate = new Date();

		// Verify that no deprecated models are returned
		for (const model of json.data) {
			if (model.deprecated_at) {
				const deprecatedAt = new Date(model.deprecated_at);
				expect(currentDate <= deprecatedAt).toBe(true);
			}
		}
	});

	test("GET /v1/models should handle both parameters together", async () => {
		const res = await app.request(
			"/v1/models?include_deactivated=true&exclude_deprecated=true",
		);
		expect(res.status).toBe(200);

		const json = await res.json();
		const currentDate = new Date();

		// Should include deactivated models but exclude deprecated ones
		for (const model of json.data) {
			if (model.deprecated_at) {
				const deprecatedAt = new Date(model.deprecated_at);
				expect(currentDate <= deprecatedAt).toBe(true);
			}
		}
	});

	test("GET /v1/models should include proper output modalities for gemini-2.5-flash-image-preview", async () => {
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const json = await res.json();

		// Find the gemini-2.5-flash-image-preview model
		const imageModel = json.data.find(
			(model: any) => model.id === "gemini-2.5-flash-image-preview",
		);

		expect(imageModel).toBeDefined();
		expect(imageModel.architecture.output_modalities).toContain("text");
		expect(imageModel.architecture.output_modalities).toContain("image");
		expect(imageModel.architecture.output_modalities).toEqual([
			"text",
			"image",
		]);
	});

	test("GET /v1/models should include stability information for models", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		// Check that the stability field exists in the model schema (models may or may not have it set)
		const modelsWithStability = json.data.filter(
			(model: any) => model.stability !== undefined,
		);
		// At least one model should have stability information (our DeepSeek models)
		expect(modelsWithStability.length).toBeGreaterThan(0);

		// Find DeepSeek models to test specific stability flags
		const deepSeekR1Distill = json.data.find(
			(model: any) => model.id === "deepseek-r1-distill-llama-70b",
		);
		const deepSeekV31 = json.data.find(
			(model: any) => model.id === "deepseek-v3.1",
		);

		if (deepSeekR1Distill) {
			expect(deepSeekR1Distill.stability).toBe("beta");
		}

		// DeepSeek v3.1 should default to stable (undefined in response means stable)
		if (deepSeekV31) {
			expect(
				deepSeekV31.stability === undefined ||
					deepSeekV31.stability === "stable",
			).toBe(true);
		}
	});

	test("GET /v1/models should handle stability field values correctly", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		// Validate that stability field contains only valid values
		const validStabilityValues = [
			"stable",
			"beta",
			"unstable",
			"experimental",
			undefined,
		];

		for (const model of json.data) {
			if (model.stability !== undefined) {
				expect(validStabilityValues).toContain(model.stability);
			}
		}
	});
});
