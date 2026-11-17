import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { and, db, eq, tables } from "@llmgateway/db";

import {
	MODELS_ENDPOINT_FILING_NOTE,
	parsePublishedPrices,
	resolveModelsEndpoint,
	syncAirsideCarrierPrices,
} from "./airside-price-sync.js";

import type { CarrierModelsFetch } from "./airside-price-sync.js";

describe("parsePublishedPrices", () => {
	test("reads per-token prices and drops malformed entries", () => {
		const prices = parsePublishedPrices({
			data: [
				{
					id: "full",
					pricing: {
						prompt: "0.000001",
						completion: 2e-6,
						input_cache_read: "1e-7",
						request: "0.01",
					},
				},
				{ id: "minimal", pricing: { prompt: "1e-6", completion: "2e-6" } },
				{ id: "unpriced" },
				{ id: "negative", pricing: { prompt: "-1", completion: "2e-6" } },
				{ id: "hex", pricing: { prompt: "0x1F", completion: "2e-6" } },
				{
					id: "bad-optional",
					pricing: { prompt: "1e-6", completion: "2e-6", request: "free" },
				},
				{ pricing: { prompt: "1e-6", completion: "2e-6" } },
			],
		});
		expect([...prices.keys()]).toEqual(["full", "minimal"]);
		expect(prices.get("full")).toEqual({
			inputPrice: "0.000001",
			outputPrice: "0.000002",
			cachedInputPrice: "1e-7",
			requestPrice: "0.01",
		});
		expect(parsePublishedPrices("nope").size).toBe(0);
	});
});

describe("syncAirsideCarrierPrices", () => {
	let suffix = "";
	let companyId = "";
	let providerId = "";
	let modelName = "";
	let modelId = "";

	const respond = (pricing: Record<string, unknown>): CarrierModelsFetch =>
		vi.fn(
			async () =>
				new Response(
					JSON.stringify({ data: [{ id: `ext-${suffix}`, pricing }] }),
					{ status: 200 },
				),
		);

	const filings = () =>
		db
			.select()
			.from(tables.providerPriceFiling)
			.where(eq(tables.providerPriceFiling.draftModelId, modelId));

	const mapping = () =>
		db.query.modelProviderMapping.findFirst({
			where: {
				modelId: { eq: modelName },
				providerId: { eq: providerId },
				region: { isNull: true },
			},
		});

	const setAutoApprove = (autoApproveFares: boolean) =>
		db
			.update(tables.providerClaim)
			.set({ autoApproveFares })
			.where(eq(tables.providerClaim.providerId, providerId));

	beforeEach(async () => {
		suffix = randomUUID().slice(0, 8);
		companyId = `sync-co-${suffix}`;
		providerId = `sync-carrier-${suffix}`;
		modelName = `sync-model-${suffix}`;
		await db
			.insert(tables.providerCompany)
			.values({ id: companyId, name: "Sync Co" });
		await db.insert(tables.providerClaim).values({
			providerCompanyId: companyId,
			providerId,
			kind: "custom",
			matchedDomain: "carrier.example",
			customBaseUrl: "https://api.carrier.example/",
			status: "active",
			autoApproveFares: true,
		});
		const [model] = await db
			.insert(tables.providerDraftModel)
			.values({
				providerCompanyId: companyId,
				providerId,
				modelName,
				externalId: `ext-${suffix}`,
				status: "active",
			})
			.returning();
		modelId = model.id;
		await db.insert(tables.providerPriceFiling).values({
			draftModelId: modelId,
			providerCompanyId: companyId,
			kind: "initial",
			inputPrice: "1e-6",
			outputPrice: "2e-6",
			cachedInputPrice: "1e-7",
			regionPrices: [{ region: "eu", inputPrice: "5e-6", outputPrice: "6e-6" }],
			status: "approved",
		});
	});

	afterEach(async () => {
		await db
			.delete(tables.modelProviderMapping)
			.where(
				and(
					eq(tables.modelProviderMapping.modelId, modelName),
					eq(tables.modelProviderMapping.providerId, providerId),
				),
			);
		await db.delete(tables.model).where(eq(tables.model.id, modelName));
		await db.delete(tables.provider).where(eq(tables.provider.id, providerId));
		await db
			.delete(tables.providerCompany)
			.where(eq(tables.providerCompany.id, companyId));
	});

	test("files and applies a changed price once", async () => {
		const fetchModels = respond({ prompt: "0.000003", completion: "4e-6" });
		expect(await syncAirsideCarrierPrices(fetchModels)).toBe(1);
		expect(fetchModels).toHaveBeenCalledWith(
			"https://api.carrier.example/v1/models",
			expect.objectContaining({ method: "GET" }),
		);

		const rows = await filings();
		expect(rows).toHaveLength(2);
		expect(rows.find((row) => row.kind === "update")).toMatchObject({
			status: "approved",
			autoApproved: true,
			note: MODELS_ENDPOINT_FILING_NOTE,
			inputPrice: "0.000003",
			outputPrice: "4e-6",
			// Unpublished prices and regional fares carry over.
			cachedInputPrice: "1e-7",
			regionPrices: [{ region: "eu", inputPrice: "5e-6", outputPrice: "6e-6" }],
		});
		const live = await mapping();
		expect(live?.source).toBe("airside");
		expect(Number(live?.inputPrice)).toBeCloseTo(3e-6, 12);
		expect(Number(live?.outputPrice)).toBeCloseTo(4e-6, 12);
		expect(Number(live?.cachedInputPrice)).toBeCloseTo(1e-7, 12);

		// The same published price, written differently, is not a change.
		expect(
			await syncAirsideCarrierPrices(
				respond({ prompt: "3e-6", completion: "0.000004" }),
			),
		).toBe(0);
		expect(await filings()).toHaveLength(2);
	});

	test("leaves carriers without automatic approval alone", async () => {
		await setAutoApprove(false);
		const fetchModels = respond({ prompt: "3e-6", completion: "4e-6" });
		expect(await syncAirsideCarrierPrices(fetchModels)).toBe(0);
		expect(fetchModels).not.toHaveBeenCalled();
		expect(await filings()).toHaveLength(1);
	});

	test("skips a listing with a filing awaiting review", async () => {
		await db.insert(tables.providerPriceFiling).values({
			draftModelId: modelId,
			providerCompanyId: companyId,
			kind: "update",
			inputPrice: "9e-6",
			outputPrice: "9e-6",
		});
		expect(
			await syncAirsideCarrierPrices(
				respond({ prompt: "3e-6", completion: "4e-6" }),
			),
		).toBe(0);
		expect(await mapping()).toBeUndefined();
	});

	test("a failing endpoint changes nothing", async () => {
		const fetchModels: CarrierModelsFetch = vi.fn(
			async () => new Response("nope", { status: 500 }),
		);
		expect(await syncAirsideCarrierPrices(fetchModels)).toBe(0);
		expect(await filings()).toHaveLength(1);
	});
});

describe("syncAirsideCarrierPrices for a catalogue carrier", () => {
	const providerId = "mistral";
	let suffix = "";
	let companyId = "";
	let modelName = "";
	let modelId = "";

	beforeEach(async () => {
		suffix = randomUUID().slice(0, 8);
		companyId = `catalogue-co-${suffix}`;
		modelName = `catalogue-model-${suffix}`;
		vi.stubEnv("LLM_MISTRAL_API_KEY", ["platform", "token", suffix].join("-"));
		await db
			.delete(tables.providerKey)
			.where(eq(tables.providerKey.provider, providerId));
		await db
			.insert(tables.providerCompany)
			.values({ id: companyId, name: "Catalogue Co" });
		await db.insert(tables.providerClaim).values({
			providerCompanyId: companyId,
			providerId,
			matchedDomain: "mistral.ai",
			// Dormant on a catalogue claim: the platform credential must never
			// follow it.
			customBaseUrl: "https://elsewhere.example",
			status: "active",
			autoApproveFares: true,
		});
		const [model] = await db
			.insert(tables.providerDraftModel)
			.values({
				providerCompanyId: companyId,
				providerId,
				modelName,
				externalId: `ext-${suffix}`,
				status: "active",
			})
			.returning();
		modelId = model.id;
		await db.insert(tables.providerPriceFiling).values({
			draftModelId: modelId,
			providerCompanyId: companyId,
			kind: "initial",
			inputPrice: "1e-6",
			outputPrice: "2e-6",
			status: "approved",
		});
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await db
			.delete(tables.modelProviderMapping)
			.where(
				and(
					eq(tables.modelProviderMapping.modelId, modelName),
					eq(tables.modelProviderMapping.providerId, providerId),
				),
			);
		await db.delete(tables.model).where(eq(tables.model.id, modelName));
		await db
			.delete(tables.providerCompany)
			.where(eq(tables.providerCompany.id, companyId));
	});

	test("reads the provider's own API with the platform credential", async () => {
		const [claim] = await db
			.select()
			.from(tables.providerClaim)
			.where(eq(tables.providerClaim.providerCompanyId, companyId));
		const endpoint = await resolveModelsEndpoint(claim);
		expect(endpoint?.url).toBe("https://api.mistral.ai/v1/models");
		expect(endpoint?.token === process.env.LLM_MISTRAL_API_KEY).toBe(true);

		const requests: { url: string; authorized: boolean }[] = [];
		const fetchModels: CarrierModelsFetch = async (url, init) => {
			const headers = new Headers(init.headers);
			requests.push({
				url,
				authorized:
					headers.get("authorization") ===
					`Bearer ${process.env.LLM_MISTRAL_API_KEY}`,
			});
			return new Response(
				JSON.stringify({
					data: [
						{
							id: `ext-${suffix}`,
							pricing: { prompt: "3e-6", completion: "4e-6" },
						},
					],
				}),
				{ status: 200 },
			);
		};
		expect(await syncAirsideCarrierPrices(fetchModels)).toBe(1);
		expect(requests).toEqual([
			{ url: "https://api.mistral.ai/v1/models", authorized: true },
		]);
		const rows = await db
			.select()
			.from(tables.providerPriceFiling)
			.where(eq(tables.providerPriceFiling.draftModelId, modelId));
		expect(rows.find((row) => row.kind === "update")).toMatchObject({
			status: "approved",
			autoApproved: true,
			inputPrice: "3e-6",
		});
	});
});
