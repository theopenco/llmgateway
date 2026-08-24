import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { deleteAll } from "@/testing.js";

import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";

const PROVIDER_ID = "openai";
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
		totalTimeToFirstToken: number;
		timeToFirstTokenCount: number;
		totalTimeToFirstReasoningToken?: number;
		timeToFirstReasoningTokenCount?: number;
	},
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
		...stats,
	});
}

async function fetchProviderStats() {
	const res = await app.request("/public/providers/stats?window=24h");
	expect(res.status).toBe(200);
	const body = await res.json();
	return body.providers.find(
		(p: { providerId: string }) => p.providerId === PROVIDER_ID,
	);
}

describe("public providers stats", () => {
	beforeEach(async () => {
		await deleteAll();
		// The endpoint read-through caches on a stable per-window tag with
		// autoInvalidate off, so a seeded row alone won't dislodge the previous
		// test's result.
		await redisClient.flushdb();
	});

	afterEach(async () => {
		await db.delete(tables.modelProviderMappingHistory);
		await deleteAll();
	});

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
			totalTimeToFirstToken: 0,
			timeToFirstTokenCount: 0,
		});

		const provider = await fetchProviderStats();
		expect(provider.errorsCount).toBe(2);
		expect(provider.uptime).toBeCloseTo((7 / 9) * 100);
	});
});
