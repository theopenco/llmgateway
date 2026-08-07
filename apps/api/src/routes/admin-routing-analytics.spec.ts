import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import { models, type ProviderModelMapping } from "@llmgateway/models";

const originalAdminEmails = process.env.ADMIN_EMAILS;

function isRoutableMapping(mapping: ProviderModelMapping): boolean {
	return (
		!mapping.deactivatedAt &&
		mapping.stability !== "unstable" &&
		mapping.stability !== "experimental"
	);
}

// A catalogue model with at least two routable provider mappings, so the
// weighted-score path (rather than single-provider selection) is exercised.
const testModel = models.find(
	(m) =>
		!("stability" in m && (m.stability as string) !== "stable") &&
		m.providers.filter(isRoutableMapping).length >= 2,
)!;
const [providerA, providerB] = testModel.providers
	.filter(isRoutableMapping)
	.map((p) => p.providerId);

function currentHourStart(): Date {
	const hour = new Date();
	hour.setUTCMinutes(0, 0, 0);
	return hour;
}

async function get(query: string, token?: string): Promise<Response> {
	return await app.request(`/admin/routing-analytics${query}`, {
		headers: token ? { Cookie: token } : {},
	});
}

describe("admin routing analytics endpoint", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	it("rejects unauthenticated and non-admin requests", async () => {
		expect((await get(`?modelId=${testModel.id}`)).status).toBe(401);

		process.env.ADMIN_EMAILS = "someone-else@example.com";
		expect((await get(`?modelId=${testModel.id}`, cookie)).status).toBe(403);
	});

	it("returns 404 for an unknown model", async () => {
		const res = await get("?modelId=does-not-exist", cookie);
		expect(res.status).toBe(404);
	});

	it("derives hourly metrics and scores from mapping history", async () => {
		const hour = currentHourStart();
		await db.insert(tables.modelProviderMappingHistoryHourly).values([
			{
				id: "routing-analytics-a",
				modelId: testModel.id,
				providerId: providerA,
				modelProviderMappingId: `${testModel.id}-${providerA}`,
				hourTimestamp: hour,
				logsCount: 10,
				errorsCount: 3,
				clientErrorsCount: 1,
				totalOutputTokens: 5000,
				totalDuration: 10000,
				totalTimeToFirstToken: 4000,
				timeToFirstTokenCount: 4,
			},
			{
				id: "routing-analytics-b",
				modelId: testModel.id,
				providerId: providerB,
				modelProviderMappingId: `${testModel.id}-${providerB}`,
				hourTimestamp: hour,
				logsCount: 10,
				errorsCount: 1,
				clientErrorsCount: 1,
				totalOutputTokens: 20000,
				totalDuration: 10000,
				totalTimeToFirstToken: 2000,
				timeToFirstTokenCount: 4,
			},
		]);

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.model.id).toBe(testModel.id);
		expect(body.window).toBe("24h");
		expect(body.hourly).toHaveLength(24);
		expect(body.config.weights.price).toBeGreaterThan(0);

		const mappingA = body.mappings.find(
			(m: { providerId: string }) => m.providerId === providerA,
		);
		expect(mappingA.routable).toBe(true);
		expect(mappingA.price).toBeGreaterThanOrEqual(0);

		const lastHour = body.hourly[body.hourly.length - 1];
		expect(lastHour.hour).toBe(hour.toISOString());

		const entryA = lastHour.providers.find(
			(p: { providerId: string }) => p.providerId === providerA,
		);
		// errors 3 minus client errors 1 = 2 routing errors out of 10 requests
		expect(entryA.uptime).toBe(80);
		expect(entryA.latency).toBe(1000);
		expect(entryA.throughput).toBe(500);
		expect(entryA.requestCount).toBe(10);
		expect(entryA.score).not.toBeNull();
		// uptime 80 is below the 95 penalty threshold, so the exponential
		// penalty applies: ((95-80)/95*5)^2
		expect(entryA.breakdown.uptimePenalty).toBeCloseTo(0.6233, 3);

		const entryB = lastHour.providers.find(
			(p: { providerId: string }) => p.providerId === providerB,
		);
		expect(entryB.uptime).toBe(100);
		expect(entryB.latency).toBe(500);
		expect(entryB.throughput).toBe(2000);
		expect(entryB.breakdown.uptimePenalty).toBe(0);

		// An hour without traffic reports null metrics (routing falls back to
		// configured defaults there) but still carries a computed score.
		const emptyHour = body.hourly[0];
		const emptyEntry = emptyHour.providers.find(
			(p: { providerId: string }) => p.providerId === providerA,
		);
		expect(emptyEntry.uptime).toBeNull();
		expect(emptyEntry.score).not.toBeNull();

		const summaryA = body.summary.find(
			(s: { providerId: string }) => s.providerId === providerA,
		);
		expect(summaryA.requestCount).toBe(10);
		expect(summaryA.uptime).toBe(80);
	});
});
