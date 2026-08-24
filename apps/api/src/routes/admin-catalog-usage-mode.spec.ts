import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { and, db, eq, tables } from "@llmgateway/db";

const MODEL_ID = "catalog-mode-model";
const PROVIDER_ID = "catalog-mode-provider";
const MAPPING_ID = "catalog-mode-mapping";
const ONE_HOUR_MS = 60 * 60 * 1000;
const BUCKET = new Date();
BUCKET.setUTCMinutes(0, 0, 0);
const RANGE = new URLSearchParams({
	from: new Date(BUCKET.getTime() - ONE_HOUR_MS).toISOString(),
	to: new Date(BUCKET.getTime() + ONE_HOUR_MS).toISOString(),
}).toString();

interface CatalogResponse {
	requests: number;
	tokens: number;
	cost: number;
}

async function clearFixtures() {
	await db
		.delete(tables.modelProviderMappingHistory)
		.where(eq(tables.modelProviderMappingHistory.modelId, MODEL_ID));
	await db
		.delete(tables.modelHistory)
		.where(eq(tables.modelHistory.modelId, MODEL_ID));
	await db
		.delete(tables.modelProviderMapping)
		.where(eq(tables.modelProviderMapping.id, MAPPING_ID));
	await db.delete(tables.model).where(eq(tables.model.id, MODEL_ID));
	await db.delete(tables.provider).where(eq(tables.provider.id, PROVIDER_ID));
}

describe("admin catalog usage mode", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await clearFixtures();

		await db.insert(tables.provider).values({
			id: PROVIDER_ID,
			name: "Catalog Mode Provider",
			description: "Test provider",
		});
		await db.insert(tables.model).values({
			id: MODEL_ID,
			name: "Catalog Mode Model",
			family: "test",
		});
		await db.insert(tables.modelProviderMapping).values({
			id: MAPPING_ID,
			modelId: MODEL_ID,
			providerId: PROVIDER_ID,
			externalId: MODEL_ID,
		});

		const buckets = [
			{ usedMode: "credits" as const, requests: 3, tokens: 30, cost: 0.3 },
			{ usedMode: "api-keys" as const, requests: 2, tokens: 20, cost: 0.2 },
			{ usedMode: "unknown" as const, requests: 1, tokens: 10, cost: 0.1 },
		];
		await db.insert(tables.modelHistory).values(
			buckets.map((bucket) => ({
				modelId: MODEL_ID,
				minuteTimestamp: BUCKET,
				usedMode: bucket.usedMode,
				logsCount: bucket.requests,
				totalTokens: bucket.tokens,
				totalInputTokens: bucket.tokens,
				totalCost: bucket.cost,
				totalInputCost: bucket.cost,
			})),
		);
		await db.insert(tables.modelProviderMappingHistory).values(
			buckets.map((bucket) => ({
				modelId: MODEL_ID,
				providerId: PROVIDER_ID,
				modelProviderMappingId: MAPPING_ID,
				minuteTimestamp: BUCKET,
				usedMode: bucket.usedMode,
				logsCount: bucket.requests,
				totalTokens: bucket.tokens,
				totalInputTokens: bucket.tokens,
				totalCost: bucket.cost,
				totalInputCost: bucket.cost,
			})),
		);
	});

	afterEach(async () => {
		await clearFixtures();
		await deleteAll();
	});

	async function fetchCatalog(
		path: "models" | "providers" | "model-provider-mappings",
		mode?: "credits" | "api-keys",
	): Promise<CatalogResponse> {
		const modeParam = mode ? `&mode=${mode}` : "";
		const response = await app.request(`/admin/${path}?${RANGE}${modeParam}`, {
			headers: { Cookie: cookie },
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			models?: { logsCount: number; totalTokens: number; totalCost: number }[];
			providers?: {
				logsCount: number;
				totalTokens: number;
				totalCost: number;
			}[];
			mappings?: { logsCount: number; inputTokens: number; cost: number }[];
		};
		const row =
			body.models?.find((item) => item.totalTokens > 0) ??
			body.providers?.find((item) => item.totalTokens > 0) ??
			body.mappings?.find((item) => item.inputTokens > 0);
		expect(row).toBeDefined();
		return {
			requests: row!.logsCount,
			tokens: "totalTokens" in row! ? row!.totalTokens : row!.inputTokens,
			cost: "cost" in row! ? row!.cost : row!.totalCost,
		};
	}

	for (const path of [
		"models",
		"providers",
		"model-provider-mappings",
	] as const) {
		it(`filters every ${path} metric by usage mode`, async () => {
			await expect(fetchCatalog(path, "credits")).resolves.toEqual({
				requests: 3,
				tokens: 30,
				cost: expect.closeTo(0.3),
			});
			await expect(fetchCatalog(path, "api-keys")).resolves.toEqual({
				requests: 2,
				tokens: 20,
				cost: expect.closeTo(0.2),
			});
			await expect(fetchCatalog(path)).resolves.toEqual({
				requests: 6,
				tokens: 60,
				cost: expect.closeTo(0.6),
			});
		});
	}

	it("filters expanded history charts by usage mode", async () => {
		for (const path of [
			`models/${MODEL_ID}/history`,
			`providers/${PROVIDER_ID}/history`,
			`providers/${PROVIDER_ID}/models/${MODEL_ID}/history`,
		]) {
			const response = await app.request(
				`/admin/${path}?window=24h&mode=credits`,
				{ headers: { Cookie: cookie } },
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				data: {
					logsCount: number;
					totalTokens: number;
					totalCost: number;
				}[];
			};
			expect(body.data).toEqual([
				expect.objectContaining({
					logsCount: 3,
					totalTokens: 30,
					totalCost: expect.closeTo(0.3),
				}),
			]);
		}
	});

	it("keeps history mode buckets unique", async () => {
		const rows = await db
			.select({ usedMode: tables.modelHistory.usedMode })
			.from(tables.modelHistory)
			.where(
				and(
					eq(tables.modelHistory.modelId, MODEL_ID),
					eq(tables.modelHistory.minuteTimestamp, BUCKET),
				),
			);
		expect(rows.map((row) => row.usedMode).sort()).toEqual([
			"api-keys",
			"credits",
			"unknown",
		]);
	});
});
