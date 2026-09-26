import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { db, provider, model, modelProviderMapping, eq } from "@llmgateway/db";

import { syncProvidersAndModels } from "./sync-models.js";

const DRIFT_MODEL_ID = "claude-3-5-sonnet";
const DRIFT_PROVIDER_ID = "anthropic";
const AIRSIDE_MODEL_ID = "gpt-4o";
const AIRSIDE_PROVIDER_ID = "openai";

/**
 * A catalogue pass writes every provider, model and mapping row by row, which
 * takes well past the default hook timeout on a loaded machine.
 */
const SYNC_TIMEOUT_MS = 180_000;

async function resetCatalogue() {
	await db.delete(modelProviderMapping);
	await db.delete(model);
	await db.delete(provider);
}

/**
 * A sync pass writes every provider, model and mapping in the catalogue one row
 * at a time, which makes it the single slowest operation in the unit suite.
 * These tests therefore share two passes — one to populate, one to re-sync —
 * rather than taking a pass each.
 */
describe("sync-models", () => {
	beforeAll(async () => {
		await resetCatalogue();
		await syncProvidersAndModels();
	}, SYNC_TIMEOUT_MS);

	afterAll(resetCatalogue, SYNC_TIMEOUT_MS);

	it("should sync providers from @llmgateway/models package", async () => {
		const providers = await db.select().from(provider);

		expect(providers.length).toBeGreaterThan(0);

		const providerIds = providers.map((p) => p.id);
		expect(providerIds).toContain("openai");
		expect(providerIds).toContain("anthropic");
		expect(providerIds).toContain("google-ai-studio");
		expect(providerIds).toContain("glacier");

		const openaiProvider = providers.find((p) => p.id === "openai");
		expect(openaiProvider).toBeTruthy();
		expect(openaiProvider?.name).toBe("OpenAI");
		expect(openaiProvider?.streaming).toBe(true);
		expect(openaiProvider?.status).toBe("active");
	});

	it("should sync models from @llmgateway/models package", async () => {
		const models = await db.select().from(model);

		expect(models.length).toBeGreaterThan(0);

		const modelIds = models.map((m) => m.id);
		expect(modelIds).toContain("gpt-4o");
		expect(modelIds).toContain("claude-3-5-sonnet");

		const gptModel = models.find((m) => m.id === "gpt-4o");
		expect(gptModel).toBeTruthy();
		expect(gptModel?.family).toBe("openai");
		expect(gptModel?.status).toBe("active");
	});

	it("should sync model-provider mappings", async () => {
		const mappings = await db.select().from(modelProviderMapping);

		expect(mappings.length).toBeGreaterThan(0);

		const gptOpenaiMapping = mappings.find(
			(m) => m.modelId === "gpt-4o" && m.providerId === "openai",
		);
		expect(gptOpenaiMapping).toBeTruthy();
		expect(gptOpenaiMapping?.externalId).toBe("gpt-4o");
		expect(gptOpenaiMapping?.status).toBe("active");
	});

	it("should handle models with pricing information", async () => {
		const [mappingWithPricing] = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.modelId, "gpt-4o"))
			.limit(1);

		expect(mappingWithPricing).toBeTruthy();
		expect(mappingWithPricing!.inputPrice).not.toBeNull();
		expect(mappingWithPricing!.outputPrice).not.toBeNull();
	});

	describe("a second pass", () => {
		let driftedMappingId: string;
		let catalogueExternalId: string | null;
		let airsideMappingId: string;
		let mappingCountBeforeResync: number;

		beforeAll(async () => {
			await db
				.update(provider)
				.set({ name: "Old OpenAI Name", streaming: false })
				.where(eq(provider.id, "openai"));

			await db
				.update(model)
				.set({ name: "Old GPT-4o Name", family: "old-family" })
				.where(eq(model.id, "gpt-4o"));

			const drifted = await db.query.modelProviderMapping.findFirst({
				where: {
					modelId: { eq: DRIFT_MODEL_ID },
					providerId: { eq: DRIFT_PROVIDER_ID },
					region: { isNull: true },
				},
			});
			expect(drifted).toBeTruthy();
			driftedMappingId = drifted!.id;
			catalogueExternalId = drifted!.externalId;
			await db
				.update(modelProviderMapping)
				.set({ externalId: "old-model-name", streaming: false })
				.where(eq(modelProviderMapping.id, driftedMappingId));

			const airside = await db.query.modelProviderMapping.findFirst({
				where: {
					modelId: { eq: AIRSIDE_MODEL_ID },
					providerId: { eq: AIRSIDE_PROVIDER_ID },
					region: { isNull: true },
				},
			});
			expect(airside).toBeTruthy();
			airsideMappingId = airside!.id;
			await db
				.update(modelProviderMapping)
				.set({
					source: "airside",
					externalId: "carrier-gpt-4o",
					inputPrice: "9e-6",
					audio: true,
				})
				.where(eq(modelProviderMapping.id, airsideMappingId));

			mappingCountBeforeResync = (await db.select().from(modelProviderMapping))
				.length;

			await syncProvidersAndModels();
		}, SYNC_TIMEOUT_MS);

		it("restores a drifted provider", async () => {
			const [openaiProvider] = await db
				.select()
				.from(provider)
				.where(eq(provider.id, "openai"));

			expect(openaiProvider!.name).toBe("OpenAI");
			expect(openaiProvider!.streaming).toBe(true);
			expect(openaiProvider!.updatedAt).not.toBeNull();
		});

		it("restores a drifted model", async () => {
			const [gptModel] = await db
				.select()
				.from(model)
				.where(eq(model.id, "gpt-4o"));

			expect(gptModel!.family).toBe("openai");
			expect(gptModel!.updatedAt).not.toBeNull();
		});

		it("restores a drifted model-provider mapping", async () => {
			const [restored] = await db
				.select()
				.from(modelProviderMapping)
				.where(eq(modelProviderMapping.id, driftedMappingId));

			expect(restored!.externalId).toBe(catalogueExternalId);
			expect(restored!.streaming).toBe(true);
			expect(restored!.updatedAt).not.toBeNull();
		});

		it("preserves Airside-owned model-provider mappings", async () => {
			const [preserved] = await db
				.select()
				.from(modelProviderMapping)
				.where(eq(modelProviderMapping.id, airsideMappingId));

			expect(preserved).toMatchObject({
				source: "airside",
				externalId: "carrier-gpt-4o",
				audio: true,
			});
			expect(Number(preserved!.inputPrice)).toBeCloseTo(9e-6);
		});

		it("never drops existing mappings", async () => {
			const mappings = await db.select().from(modelProviderMapping);

			expect(mappings.length).toBeGreaterThanOrEqual(mappingCountBeforeResync);
		});
	});
});
