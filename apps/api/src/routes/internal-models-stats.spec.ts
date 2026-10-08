import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

vi.mock("@/lib/arena-benchmarks.js", () => ({
	getArenaBenchmarks: vi.fn(async () => ({ text: [], code: [] })),
	findArenaMatch: vi.fn(() => null),
}));

const PROVIDER_ID = "model-stats-test-carrier";
const MODEL_ID = "model-stats-test-model";

const HOUR_MS = 60 * 60_000;

interface SeedStats {
	logsCount: number;
	gatewayErrorsCount: number;
	totalTokens: number;
}

async function seedMinute(usedMode: "credits" | "api-keys", stats: SeedStats) {
	const minuteMs = 60_000;
	const previousMinute = Math.floor(Date.now() / minuteMs) - 1;
	await db.insert(tables.modelProviderMappingHistory).values({
		modelId: MODEL_ID,
		providerId: PROVIDER_ID,
		modelProviderMappingId: `${MODEL_ID}::${PROVIDER_ID}`,
		minuteTimestamp: new Date(previousMinute * minuteMs),
		usedMode,
		errorsCount: stats.gatewayErrorsCount,
		...stats,
	});
}

// The uptime page reads the hourly rollup, which the worker refreshes every
// minute for the in-progress hour.
async function seedHour(
	usedMode: "credits" | "api-keys",
	hourTimestamp: Date,
	stats: SeedStats,
) {
	await db.insert(tables.modelProviderMappingHistoryHourly).values({
		modelId: MODEL_ID,
		providerId: PROVIDER_ID,
		modelProviderMappingId: `${MODEL_ID}::${PROVIDER_ID}`,
		hourTimestamp,
		usedMode,
		errorsCount: stats.gatewayErrorsCount,
		...stats,
	});
}

describe("public model stats", () => {
	beforeEach(async () => {
		await deleteAll();
		await db.delete(tables.modelProviderMappingHistory);
		await db.delete(tables.modelProviderMappingHistoryHourly);
		await db.insert(tables.provider).values({
			id: PROVIDER_ID,
			name: "Test carrier",
			description: "Database-only carrier",
		});
		const credits = { logsCount: 10, gatewayErrorsCount: 1, totalTokens: 4000 };
		// A customer's broken key must not count against the provider.
		const byok = { logsCount: 50, gatewayErrorsCount: 50, totalTokens: 9000 };
		await seedMinute("credits", credits);
		await seedMinute("api-keys", byok);
		const currentHour = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS);
		await seedHour("credits", currentHour, credits);
		await seedHour("api-keys", currentHour, byok);
		// Just outside the 24h window: must not be counted.
		const dayMs = 24 * HOUR_MS;
		await seedHour("credits", new Date(currentHour.getTime() - dayMs), {
			logsCount: 500,
			gatewayErrorsCount: 0,
			totalTokens: 1_000_000,
		});
	});

	afterEach(async () => {
		await db.delete(tables.modelProviderMappingHistory);
		await db.delete(tables.modelProviderMappingHistoryHourly);
		await db.delete(tables.provider).where(eq(tables.provider.id, PROVIDER_ID));
		await deleteAll();
	});

	test("uptime excludes bring-your-own-key traffic", async () => {
		const res = await app.request(`/internal/models/${MODEL_ID}/uptime`);
		expect(res.status).toBe(200);
		const body = await res.json();
		const provider = body.providers.find(
			(p: { providerId: string }) => p.providerId === PROVIDER_ID,
		);
		expect(provider.logsCount).toBe(10);
		expect(provider.errorsCount).toBe(1);
		expect(provider.uptime).toBe(90);
		expect(provider.totalTokens).toBe(4000);
	});

	test("uptime returns 24 zero-filled hourly buckets", async () => {
		const res = await app.request(`/internal/models/${MODEL_ID}/uptime`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.windowMinutes).toBe(24 * 60);
		expect(body.bucketMinutes).toBe(60);
		const provider = body.providers.find(
			(p: { providerId: string }) => p.providerId === PROVIDER_ID,
		);
		const points: {
			timestamp: string;
			logsCount: number;
			totalTokens: number;
		}[] = provider.points;
		expect(points).toHaveLength(24);
		for (const [i, point] of points.entries()) {
			expect(new Date(point.timestamp).getTime() % HOUR_MS).toBe(0);
			if (i > 0) {
				expect(
					new Date(point.timestamp).getTime() -
						new Date(points[i - 1].timestamp).getTime(),
				).toBe(HOUR_MS);
			}
		}
		const busy = points.filter((p) => p.logsCount > 0);
		expect(busy).toHaveLength(1);
		expect(busy[0].totalTokens).toBe(4000);
	});

	test("benchmarks exclude bring-your-own-key traffic", async () => {
		const res = await app.request(`/internal/models/${MODEL_ID}/benchmarks`);
		expect(res.status).toBe(200);
		const body = await res.json();
		const provider = body.providers.find(
			(p: { providerId: string }) => p.providerId === PROVIDER_ID,
		);
		expect(provider.logsCount).toBe(10);
		expect(provider.errorsCount).toBe(1);
		expect(provider.uptime).toBe(90);
	});
	test("benchmarks and uptime keep eligible providers with no history", async () => {
		await db.insert(tables.model).values({ id: MODEL_ID, family: "test" });
		await db.insert(tables.modelProviderMapping).values({
			id: `${MODEL_ID}::${PROVIDER_ID}`,
			modelId: MODEL_ID,
			providerId: PROVIDER_ID,
			externalId: MODEL_ID,
		});
		try {
			await db.delete(tables.modelProviderMappingHistoryHourly);
			for (const endpoint of ["benchmarks", "uptime"]) {
				const res = await app.request(
					`/internal/models/${MODEL_ID}/${endpoint}`,
				);
				expect(res.status).toBe(200);
				const body = await res.json();
				expect(
					body.providers.find(
						(row: { providerId: string }) => row.providerId === PROVIDER_ID,
					),
				).toMatchObject({ logsCount: 0, errorsCount: 0, uptime: null });
			}
		} finally {
			await db
				.delete(tables.modelProviderMapping)
				.where(eq(tables.modelProviderMapping.modelId, MODEL_ID));
			await db.delete(tables.model).where(eq(tables.model.id, MODEL_ID));
		}
	});
});
