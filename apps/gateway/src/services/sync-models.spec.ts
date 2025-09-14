import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { db, provider, model, modelProviderMapping, eq } from "@llmgateway/db";

import { syncProvidersAndModels } from "./sync-models";

describe("sync-models", () => {
	beforeEach(async () => {
		// Clean up test data before each test
		await db.delete(modelProviderMapping);
		await db.delete(model);
		await db.delete(provider);
	});

	afterEach(async () => {
		// Clean up test data after each test
		await db.delete(modelProviderMapping);
		await db.delete(model);
		await db.delete(provider);
	});

	it("should sync providers from @llmgateway/models package", async () => {
		await syncProvidersAndModels();

		const providers = await db.select().from(provider);

		// Should have synced providers from the models package
		expect(providers.length).toBeGreaterThan(0);

		// Check for specific known providers
		const providerIds = providers.map((p) => p.id);
		expect(providerIds).toContain("openai");
		expect(providerIds).toContain("anthropic");
		expect(providerIds).toContain("google-vertex");

		// Verify provider properties
		const openaiProvider = providers.find((p) => p.id === "openai");
		expect(openaiProvider).toBeTruthy();
		expect(openaiProvider?.name).toBe("OpenAI");
		expect(openaiProvider?.streaming).toBe(true);
		expect(openaiProvider?.status).toBe("active");
	});

	it("should sync models from @llmgateway/models package", async () => {
		await syncProvidersAndModels();

		const models = await db.select().from(model);

		// Should have synced models from the models package
		expect(models.length).toBeGreaterThan(0);

		// Check for specific known models
		const modelIds = models.map((m) => m.id);
		expect(modelIds).toContain("gpt-4o-mini");
		expect(modelIds).toContain("claude-3-5-sonnet-20241022");

		// Verify model properties
		const gptModel = models.find((m) => m.id === "gpt-4o-mini");
		expect(gptModel).toBeTruthy();
		expect(gptModel?.name).toBe("GPT-4o Mini");
		expect(gptModel?.family).toBe("openai");
		expect(gptModel?.status).toBe("active");
	});

	it("should sync model-provider mappings", async () => {
		await syncProvidersAndModels();

		const mappings = await db.select().from(modelProviderMapping);

		// Should have synced model-provider mappings
		expect(mappings.length).toBeGreaterThan(0);

		// Find a specific mapping (gpt-4o-mini with openai provider)
		const gptOpenAIMapping = mappings.find(
			(m) => m.modelId === "gpt-4o-mini" && m.providerId === "openai",
		);

		expect(gptOpenAIMapping).toBeTruthy();
		expect(gptOpenAIMapping?.modelName).toBe("gpt-4o-mini");
		expect(gptOpenAIMapping?.streaming).toBe(true);
		expect(gptOpenAIMapping?.status).toBe("active");
		expect(gptOpenAIMapping?.contextSize).toBeGreaterThan(0);
	});

	it("should handle updates on subsequent syncs (upsert behavior)", async () => {
		// First sync
		await syncProvidersAndModels();

		const initialProviders = await db.select().from(provider);
		const initialModels = await db.select().from(model);
		const initialMappings = await db.select().from(modelProviderMapping);

		// Second sync - should update existing records, not create duplicates
		await syncProvidersAndModels();

		const updatedProviders = await db.select().from(provider);
		const updatedModels = await db.select().from(model);
		const updatedMappings = await db.select().from(modelProviderMapping);

		// Should have same number of records (no duplicates)
		expect(updatedProviders.length).toBe(initialProviders.length);
		expect(updatedModels.length).toBe(initialModels.length);
		expect(updatedMappings.length).toBe(initialMappings.length);

		// updatedAt timestamps should be different
		const updatedProvider = updatedProviders.find((p) => p.id === "openai");
		const initialProvider = initialProviders.find((p) => p.id === "openai");

		expect(updatedProvider?.updatedAt).not.toEqual(initialProvider?.updatedAt);
	});

	it("should maintain referential integrity", async () => {
		await syncProvidersAndModels();

		const mappings = await db.select().from(modelProviderMapping);

		// Verify that all mappings reference existing providers and models
		for (const mapping of mappings) {
			const [modelExists] = await db
				.select()
				.from(model)
				.where(eq(model.id, mapping.modelId))
				.limit(1);

			const [providerExists] = await db
				.select()
				.from(provider)
				.where(eq(provider.id, mapping.providerId))
				.limit(1);

			expect(modelExists, `Model ${mapping.modelId} should exist`).toBeTruthy();
			expect(
				providerExists,
				`Provider ${mapping.providerId} should exist`,
			).toBeTruthy();
		}
	});

	it("should initialize statistics fields to default values", async () => {
		await syncProvidersAndModels();

		const providers = await db.select().from(provider);
		const models = await db.select().from(model);
		const mappings = await db.select().from(modelProviderMapping);

		// All entities should have default statistics values
		for (const p of providers) {
			expect(p.logsCount).toBe(0);
			expect(p.errorsCount).toBe(0);
			expect(p.errorRate).toBe(0);
			expect(p.throughput).toBe(0);
		}

		for (const m of models) {
			expect(m.logsCount).toBe(0);
			expect(m.errorsCount).toBe(0);
			expect(m.errorRate).toBe(0);
			expect(m.throughput).toBe(0);
		}

		for (const mapping of mappings) {
			expect(mapping.logsCount).toBe(0);
			expect(mapping.errorsCount).toBe(0);
			expect(mapping.errorRate).toBe(0);
			expect(mapping.throughput).toBe(0);
		}
	});

	it("should handle missing or invalid data gracefully", async () => {
		// This test ensures the function doesn't crash on edge cases
		// The actual data comes from the models package, so we test the function's robustness
		await expect(syncProvidersAndModels()).resolves.not.toThrow();
	});
});
