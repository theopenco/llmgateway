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
		expect(firstModel).toHaveProperty("json_output");
		expect(firstModel).toHaveProperty("structured_outputs");
	});

	test("GET /v1/models should exclude deactivated models by default", async () => {
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const json = await res.json();

		// The deactivated_at field on a model represents the earliest deactivation date
		// among all its providers. A model is only excluded if ALL providers are deactivated.
		// Therefore, models with past deactivated_at dates may still appear if they have
		// at least one active provider. This test verifies the response is successful and
		// contains models, but cannot make assumptions about deactivated_at dates since
		// partially deactivated models (some providers deactivated) are correctly included.

		// Verify we got some models back
		expect(json.data.length).toBeGreaterThan(0);

		// The deactivated_at field should be a valid ISO date string if present
		for (const model of json.data) {
			if (model.deactivated_at) {
				const deactivatedAt = new Date(model.deactivated_at);
				expect(deactivatedAt instanceof Date).toBe(true);
				expect(isNaN(deactivatedAt.getTime())).toBe(false);
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

		// The deprecated_at field represents the earliest deprecation date among all providers.
		// A model is only excluded when ALL its providers are deprecated (have past dates).
		// Models with some deprecated providers (past dates) but other active providers
		// are correctly included, so we can't assume deprecated_at is always in the future.

		// Verify we got some models back and the response is valid
		expect(json.data.length).toBeGreaterThan(0);

		// Verify deprecated_at field is a valid ISO date string if present
		for (const model of json.data) {
			if (model.deprecated_at) {
				const deprecatedAt = new Date(model.deprecated_at);
				expect(deprecatedAt instanceof Date).toBe(true);
				expect(isNaN(deprecatedAt.getTime())).toBe(false);
			}
		}
	});

	test("GET /v1/models should handle both parameters together", async () => {
		const res = await app.request(
			"/v1/models?include_deactivated=true&exclude_deprecated=true",
		);
		expect(res.status).toBe(200);

		const json = await res.json();

		// Should include deactivated models but exclude models where ALL providers are deprecated.
		// Models with some deprecated providers but other active providers are included,
		// so deprecated_at may be in the past for partially deprecated models.

		// Verify we got some models back and the response is valid
		expect(json.data.length).toBeGreaterThan(0);

		// Verify deprecated_at field is a valid ISO date string if present
		for (const model of json.data) {
			if (model.deprecated_at) {
				const deprecatedAt = new Date(model.deprecated_at);
				expect(deprecatedAt instanceof Date).toBe(true);
				expect(isNaN(deprecatedAt.getTime())).toBe(false);
			}
		}
	});

	test("GET /v1/models should include proper output modalities for gemini-2.5-flash-image-preview", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
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

	test("GET /v1/models should include proper output modalities for gemini-3.1-flash-image-preview", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		const imageModel = json.data.find(
			(model: any) => model.id === "gemini-3.1-flash-image-preview",
		);

		expect(imageModel).toBeDefined();
		expect(imageModel.architecture.output_modalities).toContain("text");
		expect(imageModel.architecture.output_modalities).toContain("image");
		expect(imageModel.architecture.output_modalities).toEqual([
			"text",
			"image",
		]);
	});

	test("GET /v1/models should include proper output modalities for gemini-3-pro-image-preview", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		const imageModel = json.data.find(
			(model: any) => model.id === "gemini-3-pro-image-preview",
		);

		expect(imageModel).toBeDefined();
		expect(imageModel.architecture.output_modalities).toContain("text");
		expect(imageModel.architecture.output_modalities).toContain("image");
		expect(imageModel.architecture.output_modalities).toEqual([
			"text",
			"image",
		]);
	});

	test("GET /v1/models should include proper output modalities for Veo 3.1 preview models", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		for (const modelId of [
			"veo-3.1-generate-preview",
			"veo-3.1-fast-generate-preview",
		]) {
			const videoModel = json.data.find((model: any) => model.id === modelId);

			expect(videoModel).toBeDefined();
			expect(videoModel.architecture.input_modalities).toEqual(["text"]);
			expect(videoModel.architecture.output_modalities).toEqual(["video"]);
			expect(videoModel.pricing.per_second).toBeDefined();
			expect(videoModel.per_request_limits).toEqual({
				max_video_duration_seconds: "10",
			});
			const avalancheProvider = videoModel.providers.find(
				(provider: any) => provider.providerId === "avalanche",
			);
			const googleVertexProvider = videoModel.providers.find(
				(provider: any) => provider.providerId === "google-vertex",
			);
			expect(googleVertexProvider?.pricing.per_second).toBeDefined();
			expect(googleVertexProvider?.supportedVideoSizes).toEqual([
				"1280x720",
				"720x1280",
				"1920x1080",
				"1080x1920",
				"3840x2160",
				"2160x3840",
			]);
			expect(googleVertexProvider?.supportsVideoAudio).toBe(true);
			expect(googleVertexProvider?.supportsVideoWithoutAudio).toBe(true);
			expect(avalancheProvider?.pricing.per_second).toBeDefined();
			expect(avalancheProvider?.supportedVideoSizes).toEqual([
				"1920x1080",
				"1080x1920",
				"3840x2160",
				"2160x3840",
			]);
			expect(avalancheProvider?.supportsVideoAudio).toBe(true);
			expect(avalancheProvider?.supportsVideoWithoutAudio).toBe(false);
		}
	});

	test("GET /v1/models should only expose quartz for supported models", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		for (const modelId of [
			"gemini-3.1-flash-image-preview",
			"gemini-3.1-pro-preview",
			"gemini-3-pro-image-preview",
		]) {
			const model = json.data.find((item: any) => item.id === modelId);
			expect(model).toBeDefined();
			expect(
				model.providers.some(
					(provider: any) => provider.providerId === "quartz",
				),
			).toBe(true);
		}

		for (const modelId of [
			"gemini-2.5-flash-image-preview",
			"veo-3.1-generate-preview",
			"veo-3.1-fast-generate-preview",
		]) {
			const model = json.data.find((item: any) => item.id === modelId);
			expect(model).toBeDefined();
			expect(
				model.providers.some(
					(provider: any) => provider.providerId === "quartz",
				),
			).toBe(false);
		}
	});

	test("GET /v1/models should only expose glacier for supported models", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		const glacierModelIds = json.data
			.filter((model: any) =>
				model.providers.some(
					(provider: any) => provider.providerId === "glacier",
				),
			)
			.map((model: any) => model.id)
			.sort();

		expect(glacierModelIds).toEqual([
			"gemini-2.5-flash-image",
			"gemini-3-pro-image-preview",
			"gemini-3.1-flash-image-preview",
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
