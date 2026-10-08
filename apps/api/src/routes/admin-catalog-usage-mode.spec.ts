import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
	avgTimeToFirstToken: number | null;
	throughput: number | null;
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
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await clearFixtures();

		await db.insert(tables.provider).values({
			id: PROVIDER_ID,
			name: "Catalog Mode Provider",
			description: "Test provider",
			avgTimeToFirstToken: 999,
		});
		await db.insert(tables.model).values({
			id: MODEL_ID,
			name: "Catalog Mode Model",
			family: "test",
			avgTimeToFirstToken: 999,
		});
		await db.insert(tables.modelProviderMapping).values({
			id: MAPPING_ID,
			modelId: MODEL_ID,
			providerId: PROVIDER_ID,
			externalId: MODEL_ID,
			avgTimeToFirstToken: 999,
		});

		const buckets = [
			{
				usedMode: "credits" as const,
				requests: 3,
				tokens: 30,
				cost: 0.3,
				totalTimeToFirstToken: 300,
				outputTokens: 30,
			},
			{
				usedMode: "api-keys" as const,
				requests: 2,
				tokens: 20,
				cost: 0.2,
				totalTimeToFirstToken: 400,
				outputTokens: 40,
			},
			{
				usedMode: "unknown" as const,
				requests: 1,
				tokens: 10,
				cost: 0.1,
				totalTimeToFirstToken: 300,
				outputTokens: 10,
			},
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
				totalTimeToFirstToken: bucket.totalTimeToFirstToken,
				timeToFirstTokenCount: bucket.requests,
				totalOutputTokens: bucket.outputTokens,
				totalDuration: 1000,
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
				totalTimeToFirstToken: bucket.totalTimeToFirstToken,
				timeToFirstTokenCount: bucket.requests,
				totalOutputTokens: bucket.outputTokens,
				totalDuration: 1000,
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
			models?: {
				logsCount: number;
				totalTokens: number;
				totalCost: number;
				avgTimeToFirstToken: number | null;
				throughput: number | null;
			}[];
			providers?: {
				logsCount: number;
				totalTokens: number;
				totalCost: number;
				avgTimeToFirstToken: number | null;
				throughput: number | null;
			}[];
			mappings?: {
				logsCount: number;
				inputTokens: number;
				cost: number;
				avgTimeToFirstToken: number | null;
				throughput: number | null;
			}[];
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
			avgTimeToFirstToken: row!.avgTimeToFirstToken,
			throughput: row!.throughput,
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
				avgTimeToFirstToken: 100,
				throughput: 30,
			});
			await expect(fetchCatalog(path, "api-keys")).resolves.toEqual({
				requests: 2,
				tokens: 20,
				cost: expect.closeTo(0.2),
				avgTimeToFirstToken: 200,
				throughput: 40,
			});
			await expect(fetchCatalog(path)).resolves.toEqual({
				requests: 6,
				tokens: 60,
				cost: expect.closeTo(0.6),
				avgTimeToFirstToken: expect.closeTo(1000 / 6),
				throughput: expect.closeTo(80 / 3),
			});
		});
	}

	it("sorts by throughput with empty rows last", async () => {
		for (const path of [
			"models",
			"providers",
			"model-provider-mappings",
		] as const) {
			for (const sortOrder of ["asc", "desc"]) {
				const response = await app.request(
					`/admin/${path}?${RANGE}&sortBy=throughput&sortOrder=${sortOrder}`,
					{ headers: { Cookie: cookie } },
				);
				expect(response.status).toBe(200);
				const body = (await response.json()) as Record<
					string,
					{ throughput: number | null }[]
				>;
				const rows =
					body[path === "model-provider-mappings" ? "mappings" : path];
				expect(rows[0]?.throughput).toEqual(expect.closeTo(80 / 3));
			}
		}
	});

	it("keeps filtered latency null without a mode sample", async () => {
		await Promise.all([
			db
				.update(tables.modelHistory)
				.set({ timeToFirstTokenCount: 0 })
				.where(
					and(
						eq(tables.modelHistory.modelId, MODEL_ID),
						eq(tables.modelHistory.usedMode, "api-keys"),
					),
				),
			db
				.update(tables.modelProviderMappingHistory)
				.set({ timeToFirstTokenCount: 0 })
				.where(
					and(
						eq(
							tables.modelProviderMappingHistory.modelProviderMappingId,
							MAPPING_ID,
						),
						eq(tables.modelProviderMappingHistory.usedMode, "api-keys"),
					),
				),
		]);

		for (const path of [
			"models",
			"providers",
			"model-provider-mappings",
		] as const) {
			await expect(fetchCatalog(path, "api-keys")).resolves.toMatchObject({
				requests: 2,
				avgTimeToFirstToken: null,
			});
		}
	});

	it("requires a complete range for narrowed modes", async () => {
		for (const path of [
			"models",
			"providers",
			"model-provider-mappings",
		] as const) {
			for (const query of [
				"mode=credits",
				`mode=credits&from=${encodeURIComponent(BUCKET.toISOString())}`,
				`mode=credits&to=${encodeURIComponent(BUCKET.toISOString())}`,
			]) {
				const response = await app.request(`/admin/${path}?${query}`, {
					headers: { Cookie: cookie },
				});
				expect(response.status).toBe(400);
			}
		}
	});

	it("rejects narrowed project-scoped history", async () => {
		for (const path of [
			`models/${MODEL_ID}/history`,
			`providers/${PROVIDER_ID}/models/${MODEL_ID}/history`,
		]) {
			for (const mode of ["credits", "api-keys"]) {
				const response = await app.request(
					`/admin/${path}?projectId=test-project&mode=${mode}`,
					{ headers: { Cookie: cookie } },
				);
				expect(response.status).toBe(400);
			}
		}
	});

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
	it.each([false, true])(
		"preserves idle history with sparse storage (hourly=%s)",
		async (hourly) => {
			const halfHourMs = 30 * 60_000;
			vi.setSystemTime(new Date(BUCKET.getTime() + halfHourMs));
			try {
				const idle = new Date(BUCKET.getTime() - ONE_HOUR_MS);
				const createdAt = new Date(idle.getTime() - ONE_HOUR_MS);
				await db
					.update(tables.model)
					.set({ createdAt })
					.where(eq(tables.model.id, MODEL_ID));
				await db
					.update(tables.modelProviderMapping)
					.set({ createdAt })
					.where(eq(tables.modelProviderMapping.id, MAPPING_ID));
				const coverage = {
					job: hourly ? "hourly-usage" : "minute-usage",
					bucketTimestamp: idle,
					refreshedAt: new Date(),
					finalizedAt: new Date(),
				};
				await db.insert(tables.aggregationProgress).values([
					coverage,
					{
						...coverage,
						bucketTimestamp: new Date(BUCKET.getTime() + ONE_HOUR_MS),
					},
					{
						...coverage,
						bucketTimestamp: new Date(idle.getTime() - 60_000),
						refreshedAt: null,
						finalizedAt: null,
					},
				]);
				const modes = ["credits", "api-keys"] as const;
				const mh = hourly ? tables.modelHistoryHourly : tables.modelHistory;
				const mph = hourly
					? tables.modelProviderMappingHistoryHourly
					: tables.modelProviderMappingHistory;
				// Explicit branches keep the different required bucket columns typed.
				if (hourly) {
					await db.insert(tables.modelHistoryHourly).values(
						modes.map((usedMode) => ({
							modelId: MODEL_ID,
							hourTimestamp: idle,
							usedMode,
						})),
					);
					await db.insert(tables.modelProviderMappingHistoryHourly).values(
						modes.map((usedMode) => ({
							modelId: MODEL_ID,
							providerId: PROVIDER_ID,
							modelProviderMappingId: MAPPING_ID,
							hourTimestamp: idle,
							usedMode,
						})),
					);
				} else {
					await db.insert(tables.modelHistory).values(
						modes.map((usedMode) => ({
							modelId: MODEL_ID,
							minuteTimestamp: idle,
							usedMode,
						})),
					);
					await db.insert(tables.modelProviderMappingHistory).values(
						modes.map((usedMode) => ({
							modelId: MODEL_ID,
							providerId: PROVIDER_ID,
							modelProviderMappingId: MAPPING_ID,
							minuteTimestamp: idle,
							usedMode,
						})),
					);
				}
				const paths = [
					`providers/${PROVIDER_ID}`,
					`models/${MODEL_ID}`,
					`providers/${PROVIDER_ID}/models/${MODEL_ID}`,
				];
				const urls = paths.flatMap((path) =>
					["total", ...modes].map(
						(mode) =>
							`/admin/${path}/history?window=${hourly ? "7d" : "4h"}&mode=${mode}`,
					),
				);
				const read = async () => {
					const results: unknown[] = [];
					for (const url of urls) {
						const res = await app.request(url, { headers: { Cookie: cookie } });
						expect(res.status).toBe(200);
						const body = await res.json();
						expect(
							body.data.find(
								(row: { timestamp: string }) =>
									row.timestamp === idle.toISOString(),
							),
						).toMatchObject({
							logsCount: 0,
							totalCost: 0,
							totalTokens: 0,
							avgTtft: null,
							avgDuration: null,
						});
						expect(
							body.data.every(
								(row: { timestamp: string }) =>
									new Date(row.timestamp) <= new Date(),
							),
						).toBe(true);
						results.push(body);
					}
					return results;
				};
				const dense = await read();
				await db
					.delete(mh)
					.where(and(eq(mh.modelId, MODEL_ID), eq(mh.logsCount, 0)));
				await db
					.delete(mph)
					.where(and(eq(mph.modelId, MODEL_ID), eq(mph.logsCount, 0)));
				expect(await read()).toEqual(dense);
			} finally {
				vi.useRealTimers();
				await db.delete(tables.aggregationProgress);
				await db
					.delete(tables.modelHistoryHourly)
					.where(eq(tables.modelHistoryHourly.modelId, MODEL_ID));
				await db
					.delete(tables.modelProviderMappingHistoryHourly)
					.where(
						eq(tables.modelProviderMappingHistoryHourly.modelId, MODEL_ID),
					);
			}
		},
	);
});
