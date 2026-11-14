import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { resetLocalPublicResponseCache } from "@/lib/public-response-cache.js";
import { deleteAll } from "@/testing.js";

import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";
import { models, providers } from "@llmgateway/models";

const YEAR = 2025;
const publicModels = models.filter((model) => model.family !== "llmgateway");
const LEADER = publicModels[0].id;
const RISER = publicModels[1].id;
const PROVIDER = providers.find((p) => p.name !== "LLM Gateway")!.id;

async function seedModelMonth(
	modelId: string,
	month: number,
	totalTokens: number,
	year = YEAR,
) {
	await db.insert(tables.modelHistoryHourly).values({
		modelId,
		usedMode: "credits",
		hourTimestamp: new Date(Date.UTC(year, month - 1, 15, 12)),
		logsCount: 10,
		totalTokens,
	});
}

async function clearHistory() {
	await db.delete(tables.modelHistoryHourly);
	await db.delete(tables.modelProviderMappingHistoryHourly);
}

describe("public usage report", () => {
	beforeEach(async () => {
		await deleteAll();
		await clearHistory();
		await redisClient.flushdb();
		resetLocalPublicResponseCache();
	});

	afterEach(async () => {
		await clearHistory();
		await deleteAll();
	});

	test("aggregates one calendar year of catalogue traffic", async () => {
		await seedModelMonth(LEADER, 1, 600);
		await seedModelMonth(LEADER, 2, 600);
		await seedModelMonth(RISER, 1, 100);
		await seedModelMonth(RISER, 2, 700);
		// Outside the year, and a model that is not in the public catalogue.
		await seedModelMonth(LEADER, 1, 5000, YEAR + 1);
		await seedModelMonth("private-custom-model", 1, 9000);
		await db.insert(tables.modelProviderMappingHistoryHourly).values({
			modelId: LEADER,
			providerId: PROVIDER,
			modelProviderMappingId: "usage-report-test",
			usedMode: "credits",
			hourTimestamp: new Date(Date.UTC(YEAR, 0, 15, 12)),
			logsCount: 10,
			totalTokens: 1200,
		});

		const res = await app.request(`/public/models/report?year=${YEAR}`);
		expect(res.status).toBe(200);
		const report = await res.json();

		expect(report.year).toBe(YEAR);
		expect(report.complete).toBe(true);
		expect(report.throughMonth).toBe("2025-02");
		expect(report.totals).toEqual({
			totalTokens: 2000,
			totalRequests: 40,
			activeModels: 2,
			activeProviders: 1,
		});
		expect(report.months).toEqual([
			{
				month: "2025-01",
				totalTokens: 700,
				totalRequests: 20,
				topModelId: LEADER,
			},
			{
				month: "2025-02",
				totalTokens: 1300,
				totalRequests: 20,
				topModelId: RISER,
			},
		]);
		expect(report.models.map((m: { modelId: string }) => m.modelId)).toEqual([
			LEADER,
			RISER,
		]);
		expect(report.models[0].sharePercent).toBe(60);
		expect(report.models[1].peakMonth).toBe("2025-02");
		expect(report.providers).toEqual([
			{
				providerId: PROVIDER,
				totalTokens: 1200,
				totalRequests: 10,
				sharePercent: 100,
			},
		]);
		expect(report.risers).toEqual([
			{
				modelId: RISER,
				previousTokens: 100,
				recentTokens: 700,
				growthPercent: 600,
			},
		]);
	});

	test("keeps private models out of provider totals", async () => {
		await seedModelMonth(LEADER, 1, 600);
		for (const [modelId, id] of [
			[LEADER, "usage-report-public"],
			["private-custom-model", "usage-report-private"],
		]) {
			await db.insert(tables.modelProviderMappingHistoryHourly).values({
				modelId,
				providerId: PROVIDER,
				modelProviderMappingId: id,
				usedMode: "credits",
				hourTimestamp: new Date(Date.UTC(YEAR, 0, 15, 12)),
				logsCount: 10,
				totalTokens: 600,
			});
		}

		const res = await app.request(`/public/models/report?year=${YEAR}`);
		const report = await res.json();
		expect(report.providers).toEqual([
			{
				providerId: PROVIDER,
				totalTokens: 600,
				totalRequests: 10,
				sharePercent: 100,
			},
		]);
	});

	test("counts requests from a month without tokens", async () => {
		await seedModelMonth(LEADER, 1, 0);
		await seedModelMonth(LEADER, 2, 500);

		const res = await app.request(`/public/models/report?year=${YEAR}`);
		const report = await res.json();
		expect(report.totals.totalRequests).toBe(20);
		expect(report.months).toEqual([
			{ month: "2025-01", totalTokens: 0, totalRequests: 10, topModelId: null },
			{
				month: "2025-02",
				totalTokens: 500,
				totalRequests: 10,
				topModelId: LEADER,
			},
		]);
		expect(report.models[0]).toMatchObject({
			modelId: LEADER,
			totalRequests: 20,
			firstActiveMonth: "2025-02",
		});
	});

	test("returns an empty report for a year without traffic", async () => {
		const res = await app.request(`/public/models/report?year=${YEAR}`);
		expect(res.status).toBe(200);
		const report = await res.json();
		expect(report.totals.totalTokens).toBe(0);
		expect(report.throughMonth).toBeNull();
		expect(report.models).toEqual([]);
	});

	test("rejects years outside the reporting range", async () => {
		const future = new Date().getUTCFullYear() + 1;
		expect(
			(await app.request(`/public/models/report?year=${future}`)).status,
		).toBe(404);
		expect((await app.request("/public/models/report?year=2024")).status).toBe(
			400,
		);
	});
});
