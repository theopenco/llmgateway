import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { deleteAll } from "@/testing.js";

import { redisClient } from "@llmgateway/cache";
import { and, db, eq, tables } from "@llmgateway/db";

const PROVIDER_ID = "stats-test-carrier";
const MODEL_ID = "gpt-4o";

/**
 * One minute of history for the provider. `logsCount` counts every request,
 * while `timeToFirstTokenCount` counts only the ones that actually produced a
 * first-token sample — non-streaming requests never do.
 */
async function seedMinute(
	minutesAgo: number,
	stats: {
		logsCount: number;
		errorsCount?: number;
		clientErrorsCount?: number;
		gatewayErrorsCount?: number;
		upstreamErrorsCount?: number;
		totalTimeToFirstToken: number;
		timeToFirstTokenCount: number;
		totalTimeToFirstReasoningToken?: number;
		timeToFirstReasoningTokenCount?: number;
	},
	usedMode: "credits" | "api-keys" = "credits",
) {
	const minuteMs = 60_000;
	const offsetMs = minutesAgo * minuteMs;
	const flooredMinutes = Math.floor((Date.now() - offsetMs) / minuteMs);
	const minuteTimestamp = new Date(flooredMinutes * minuteMs);
	await db.insert(tables.modelProviderMappingHistory).values({
		modelId: MODEL_ID,
		providerId: PROVIDER_ID,
		modelProviderMappingId: `${MODEL_ID}::${PROVIDER_ID}::${minutesAgo}`,
		minuteTimestamp,
		usedMode,
		...stats,
	});
}

async function fetchProviderStats(window = "24h") {
	const res = await app.request(`/public/providers/stats?window=${window}`);
	expect(res.status).toBe(200);
	const body = await res.json();
	return body.providers.find(
		(p: { providerId: string }) => p.providerId === PROVIDER_ID,
	);
}

describe("public providers stats", () => {
	beforeEach(async () => {
		await deleteAll();
		await db.delete(tables.modelProviderMappingHistory);
		await db.insert(tables.provider).values({
			id: PROVIDER_ID,
			name: "Test carrier",
			description: "Database-only carrier",
		});
		// The endpoint read-through caches on a stable per-window tag with
		// autoInvalidate off, so a seeded row alone won't dislodge the previous
		// test's result.
		await redisClient.flushdb();
	});

	afterEach(async () => {
		await db.delete(tables.provider).where(eq(tables.provider.id, PROVIDER_ID));
		await db
			.delete(tables.modelProviderMappingHistoryHourly)
			.where(
				eq(tables.modelProviderMappingHistoryHourly.providerId, PROVIDER_ID),
			);
		await db.delete(tables.modelProviderMappingHistory);
		await deleteAll();
	});

	test.each(["24h", "7d", "30d"])(
		"omits deleted providers but retains history (%s)",
		async (window) => {
			await seedMinute(1, {
				logsCount: 10,
				totalTimeToFirstToken: 800,
				timeToFirstTokenCount: 4,
			});
			await db.insert(tables.modelProviderMappingHistoryHourly).values({
				modelId: MODEL_ID,
				providerId: PROVIDER_ID,
				modelProviderMappingId: "deleted-mapping",
				usedMode: "credits",
				hourTimestamp: new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000),
				logsCount: 10,
			});
			expect((await fetchProviderStats(window)).logsCount).toBe(10);

			await db
				.delete(tables.provider)
				.where(eq(tables.provider.id, PROVIDER_ID));
			await redisClient.flushdb();

			expect(await fetchProviderStats(window)).toBeUndefined();
			expect(
				await db.query.modelProviderMappingHistory.findMany({
					where: { providerId: { eq: PROVIDER_ID } },
				}),
			).toHaveLength(1);
			expect(
				await db.query.modelProviderMappingHistoryHourly.findMany({
					where: { providerId: { eq: PROVIDER_ID } },
				}),
			).toHaveLength(1);
		},
	);

	test("averages TTFT over streamed requests only", async () => {
		// 10 requests, but only 4 were streamed and contributed 800ms in total.
		// Dividing by the request count would report 80ms instead of 200ms.
		await seedMinute(1, {
			logsCount: 10,
			totalTimeToFirstToken: 800,
			timeToFirstTokenCount: 4,
		});

		const provider = await fetchProviderStats();
		expect(provider.logsCount).toBe(10);
		expect(provider.avgTimeToFirstToken).toBe(200);
		// Exposed so the UI can gate the TTFT card on the sample size behind the
		// average rather than on logsCount.
		expect(provider.timeToFirstTokenCount).toBe(4);
	});

	test("prefers reasoning-token samples over content-token samples", async () => {
		// Thinking mappings stream reasoning long before the first content
		// token, so the content-token average (500ms) would misrepresent them;
		// the reasoning-token average (100ms) is the real first-token latency.
		await seedMinute(1, {
			logsCount: 10,
			totalTimeToFirstToken: 2000,
			timeToFirstTokenCount: 4,
			totalTimeToFirstReasoningToken: 300,
			timeToFirstReasoningTokenCount: 3,
		});

		const provider = await fetchProviderStats();
		expect(provider.avgTimeToFirstToken).toBe(100);
		expect(provider.timeToFirstTokenCount).toBe(3);
	});

	test("reports no TTFT when nothing was streamed", async () => {
		await seedMinute(2, {
			logsCount: 25,
			totalTimeToFirstToken: 0,
			timeToFirstTokenCount: 0,
		});

		const provider = await fetchProviderStats();
		expect(provider.logsCount).toBe(25);
		expect(provider.avgTimeToFirstToken).toBeNull();
		expect(provider.timeToFirstTokenCount).toBe(0);
	});

	test("excludes client errors from uptime and error totals", async () => {
		await seedMinute(1, {
			logsCount: 10,
			errorsCount: 3,
			clientErrorsCount: 1,
			gatewayErrorsCount: 1,
			upstreamErrorsCount: 1,
			totalTimeToFirstToken: 0,
			timeToFirstTokenCount: 0,
		});

		const provider = await fetchProviderStats();
		expect(provider.errorsCount).toBe(2);
		expect(provider.uptime).toBeCloseTo((7 / 9) * 100);
	});

	test("excludes bring-your-own-key traffic", async () => {
		await seedMinute(1, {
			logsCount: 10,
			totalTimeToFirstToken: 0,
			timeToFirstTokenCount: 0,
		});
		await seedMinute(
			1,
			{
				logsCount: 50,
				errorsCount: 50,
				gatewayErrorsCount: 50,
				totalTimeToFirstToken: 0,
				timeToFirstTokenCount: 0,
			},
			"api-keys",
		);

		const provider = await fetchProviderStats();
		expect(provider.logsCount).toBe(10);
		expect(provider.errorsCount).toBe(0);
		expect(provider.uptime).toBe(100);
	});

	test("counts upstream errors the hasError column never flagged", async () => {
		// A provider that answers 200 but ends the stream with an upstream-error
		// finish reason: classified upstream_error, but hasError stays false, so
		// errorsCount is 0 while the mapping was in fact failing.
		await seedMinute(1, {
			logsCount: 100,
			errorsCount: 0,
			clientErrorsCount: 0,
			upstreamErrorsCount: 20,
			totalTimeToFirstToken: 0,
			timeToFirstTokenCount: 0,
		});

		const provider = await fetchProviderStats();
		expect(provider.errorsCount).toBe(20);
		expect(provider.uptime).toBeCloseTo(80);
	});
	test("public statistics match without stored idle buckets", async () => {
		await seedMinute(1, {
			logsCount: 10,
			totalTimeToFirstToken: 1000,
			timeToFirstTokenCount: 2,
		});
		await seedMinute(2, {
			logsCount: 0,
			totalTimeToFirstToken: 0,
			timeToFirstTokenCount: 0,
		});
		const dense = await fetchProviderStats();
		await db
			.delete(tables.modelProviderMappingHistory)
			.where(
				and(
					eq(tables.modelProviderMappingHistory.providerId, PROVIDER_ID),
					eq(tables.modelProviderMappingHistory.logsCount, 0),
				),
			);
		await redisClient.flushdb();
		expect(await fetchProviderStats()).toEqual(dense);
	});
});
