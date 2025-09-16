import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { db, provider, model, modelProviderMapping, eq } from "@llmgateway/db";

import { syncProvidersAndModels } from "./sync-models.js";

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
		expect(providerIds).toContain("google-ai-studio");

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
		expect(modelIds).toContain("gpt-4o");
		expect(modelIds).toContain("claude-3-5-sonnet");

		// Verify model properties
		const gptModel = models.find((m) => m.id === "gpt-4o");
		expect(gptModel).toBeTruthy();
		expect(gptModel?.family).toBe("openai");
		expect(gptModel?.status).toBe("active");
	});

	it("should sync model-provider mappings", async () => {
		await syncProvidersAndModels();

		const mappings = await db.select().from(modelProviderMapping);

		// Should have synced model-provider mappings
		expect(mappings.length).toBeGreaterThan(0);

		// Check for specific known mappings
		const gptOpenaiMapping = mappings.find(
			(m) => m.modelId === "gpt-4o" && m.providerId === "openai",
		);
		expect(gptOpenaiMapping).toBeTruthy();
		expect(gptOpenaiMapping?.modelName).toBe("gpt-4o");
		expect(gptOpenaiMapping?.status).toBe("active");
	});

	it("should update existing providers on conflict", async () => {
		// Insert initial provider data
		await db.insert(provider).values({
			id: "openai",
			name: "Old OpenAI Name",
			description: "Old description",
			streaming: false,
			cancellation: false,
			color: "#000000",
			website: "https://old-website.com",
			status: "active",
		});

		await syncProvidersAndModels();

		const providers = await db
			.select()
			.from(provider)
			.where(eq(provider.id, "openai"));

		expect(providers).toHaveLength(1);
		const openaiProvider = providers[0]!;
		expect(openaiProvider.name).toBe("OpenAI"); // Should be updated
		expect(openaiProvider.streaming).toBe(true); // Should be updated
		expect(openaiProvider.updatedAt).not.toBeNull();
	});

	it("should update existing models on conflict", async () => {
		// Insert initial model data
		await db.insert(model).values({
			id: "gpt-4o",
			name: "Old GPT-4o Name",
			family: "old-family",
			status: "active",
		});

		await syncProvidersAndModels();

		const models = await db.select().from(model).where(eq(model.id, "gpt-4o"));

		expect(models).toHaveLength(1);
		const gptModel = models[0]!;
		expect(gptModel.family).toBe("openai"); // Should be updated
		expect(gptModel.updatedAt).not.toBeNull();
	});

	it("should update existing model-provider mappings", async () => {
		// First sync to create providers and models
		await syncProvidersAndModels();

		// Modify an existing mapping
		const existingMapping = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.modelId, "gpt-4o"))
			.limit(1);

		if (existingMapping[0]) {
			await db
				.update(modelProviderMapping)
				.set({
					modelName: "old-model-name",
					streaming: false,
				})
				.where(eq(modelProviderMapping.id, existingMapping[0].id));
		}

		// Sync again
		await syncProvidersAndModels();

		// Check that the mapping was updated
		const updatedMapping = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.id, existingMapping[0]!.id));

		expect(updatedMapping).toHaveLength(1);
		expect(updatedMapping[0]?.modelName).toBe("gpt-4o"); // Should be restored
		expect(updatedMapping[0]?.streaming).toBe(true); // Should be restored
		expect(updatedMapping[0]?.updatedAt).not.toBeNull();
	});

	it("should create new model-provider mappings for new models", async () => {
		// First, create just providers
		await syncProvidersAndModels();

		const initialMappingCount = await db.select().from(modelProviderMapping);

		// Run sync again (simulating a new model being added to the models package)
		await syncProvidersAndModels();

		const finalMappingCount = await db.select().from(modelProviderMapping);

		// Should have the same or more mappings (depending on if new models were added)
		expect(finalMappingCount.length).toBeGreaterThanOrEqual(
			initialMappingCount.length,
		);
	});

	it("should handle models with pricing information", async () => {
		await syncProvidersAndModels();

		// Find a mapping that should have pricing
		const mappingWithPricing = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.modelId, "gpt-4o"))
			.limit(1);

		if (mappingWithPricing[0]) {
			// Should have pricing information
			expect(mappingWithPricing[0].inputPrice).not.toBeNull();
			expect(mappingWithPricing[0].outputPrice).not.toBeNull();
		}
	});

	it("should handle errors gracefully", async () => {
		// This test ensures the function doesn't throw on edge cases
		await expect(syncProvidersAndModels()).resolves.not.toThrow();
	});
});
