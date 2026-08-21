import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { cdb, db, tables } from "@llmgateway/db";
import { models, type ProviderModelMapping } from "@llmgateway/models";

const originalAdminEmails = process.env.ADMIN_EMAILS;

// Routable *and* paid, so the price factor and the discount assertions below
// operate on a non-zero selection price.
function isRoutableMapping(mapping: ProviderModelMapping): boolean {
	return (
		!mapping.deactivatedAt &&
		mapping.stability !== "unstable" &&
		mapping.stability !== "experimental" &&
		(Number(mapping.inputPrice ?? 0) > 0 ||
			Number(mapping.outputPrice ?? 0) > 0)
	);
}

// A catalogue model with at least two routable provider mappings, so the
// weighted-score path (rather than single-provider selection) is exercised.
const testModel = models.find(
	(m) =>
		!("stability" in m && (m.stability as string) !== "stable") &&
		m.providers.filter(isRoutableMapping).length >= 2,
);
if (!testModel) {
	throw new Error(
		"No stable catalogue model with at least two paid, routable provider mappings; update this fixture.",
	);
}
const [providerA, providerB] = testModel.providers
	.filter(isRoutableMapping)
	.map((p) => p.providerId);

// One model per side of "now": a retired mapping and a scheduled one. Mappings
// are never removed from the catalogue, only dated, so the retired side always
// exists; the scheduled side is whatever is still ahead today and is simply
// omitted if nothing is. The test asserts the past/future rule as a property of
// the response rather than pinning a fixture, so it cannot start failing on its
// own once a scheduled date passes.
function findModelsWithDeactivatedMappings(): string[] {
	const now = new Date();
	let retired: string | undefined;
	let scheduled: string | undefined;
	for (const model of models) {
		for (const mapping of model.providers as ProviderModelMapping[]) {
			if (!mapping.deactivatedAt) {
				continue;
			}
			if (mapping.deactivatedAt <= now) {
				retired ??= model.id;
			} else {
				scheduled ??= model.id;
			}
		}
		if (retired && scheduled) {
			break;
		}
	}
	const modelIds = [
		...new Set([retired, scheduled].filter(Boolean)),
	] as string[];
	if (modelIds.length === 0) {
		throw new Error(
			"No catalogue mapping carries a deactivatedAt; update this fixture.",
		);
	}
	return modelIds;
}

const deactivationModelIds = findModelsWithDeactivatedMappings();

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
		// None of these tables hang off a cascade root that deleteAll() clears, so
		// the fixtures inserted here have to be removed explicitly or the next run
		// collides on their fixed ids. Discounts go through the cached client so
		// the cached lookup is dropped with them.
		await db.delete(tables.modelProviderMappingHistoryHourly);
		await db.delete(tables.routingElectionHourly);
		await db.delete(tables.routingExclusionHourly);
		await db.delete(tables.modelProviderMapping);
		await cdb.delete(tables.discount);
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
		expect(mappingA.discount).toBe(0);
		expect(mappingA.price).toBe(mappingA.listPrice);

		// Look the bucket up by timestamp rather than taking the last one: the
		// handler derives its own window end, so crossing an hour boundary between
		// the insert and the request would otherwise shift the inserted row into
		// the second-to-last bucket.
		const trafficHour = body.hourly.find(
			(h: { hour: string }) => h.hour === hour.toISOString(),
		);
		expect(trafficHour).toBeDefined();

		const entryA = trafficHour.providers.find(
			(p: { providerId: string }) => p.providerId === providerA,
		);
		// The client error is excluded from both sides: 2 stability errors among
		// the 9 uptime-relevant requests.
		expect(entryA.uptime).toBeCloseTo(77.78, 2);
		expect(entryA.latency).toBe(1000);
		expect(entryA.throughput).toBe(500);
		expect(entryA.requestCount).toBe(10);
		expect(entryA.score).not.toBeNull();
		// The uptime is below the 95 penalty threshold, so the exponential
		// penalty applies.
		expect(entryA.breakdown.uptimePenalty).toBeCloseTo(0.8216, 3);

		const entryB = trafficHour.providers.find(
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
		expect(summaryA.uptime).toBeCloseTo(77.78, 2);
	});

	it("only excludes a mapping once its deactivation date has passed", async () => {
		const now = new Date();
		let dated = 0;
		for (const modelId of deactivationModelIds) {
			const res = await get(`?modelId=${modelId}&window=24h`, cookie);
			expect(res.status).toBe(200);
			const body = await res.json();

			for (const mapping of body.mappings as {
				providerId: string;
				deactivatedAt: string | null;
				routable: boolean;
				excludedReasons: string[];
			}[]) {
				if (!mapping.deactivatedAt) {
					expect(mapping.excludedReasons).not.toContain("deactivated");
					continue;
				}
				dated++;
				if (new Date(mapping.deactivatedAt) <= now) {
					expect(mapping.excludedReasons).toContain("deactivated");
					expect(mapping.routable).toBe(false);
				} else {
					// Scheduled, not deactivated: routing compares against the date, so
					// the mapping still elects and must stay scoreable here.
					expect(mapping.excludedReasons).not.toContain("deactivated");
				}
			}
		}
		expect(dated).toBeGreaterThan(0);
	});

	it("counts a mapping's regional traffic once", async () => {
		const hour = currentHourStart();
		// A mapping with regions is stored as a region-less root row plus one row
		// per region, and the minute aggregator merges the regional traffic into
		// the root row. Summing every row of the provider therefore reports double
		// the requests that were actually served.
		await db
			.insert(tables.provider)
			.values({ id: providerA, name: providerA, description: providerA })
			.onConflictDoNothing();
		await db
			.insert(tables.model)
			.values({ id: testModel.id, family: testModel.family })
			.onConflictDoNothing();
		await db.insert(tables.modelProviderMapping).values([
			{
				id: "routing-analytics-region-root",
				modelId: testModel.id,
				providerId: providerA,
				externalId: testModel.id,
			},
			{
				id: "routing-analytics-region-east",
				modelId: testModel.id,
				providerId: providerA,
				externalId: testModel.id,
				region: "us-east-1",
			},
		]);
		await db.insert(tables.modelProviderMappingHistoryHourly).values([
			{
				id: "routing-analytics-region-root-hour",
				modelId: testModel.id,
				providerId: providerA,
				modelProviderMappingId: "routing-analytics-region-root",
				hourTimestamp: hour,
				logsCount: 12,
				serviceTierExplicitCount: 4,
			},
			{
				id: "routing-analytics-region-east-hour",
				modelId: testModel.id,
				providerId: providerA,
				modelProviderMappingId: "routing-analytics-region-east",
				hourTimestamp: hour,
				logsCount: 12,
				serviceTierExplicitCount: 4,
			},
		]);

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		const body = await res.json();

		const summaryA = body.summary.find(
			(s: { providerId: string }) => s.providerId === providerA,
		);
		expect(summaryA.requestCount).toBe(12);
		expect(body.serviceTier.requestCount).toBe(12);
		expect(body.serviceTier.explicit).toBe(4);

		const trafficHour = body.hourly.find(
			(h: { hour: string }) => h.hour === hour.toISOString(),
		);
		const entryA = trafficHour.providers.find(
			(p: { providerId: string }) => p.providerId === providerA,
		);
		expect(entryA.requestCount).toBe(12);
	});

	it("reports election paths, eligibility and service-tier coverage", async () => {
		const hour = currentHourStart();
		await db.insert(tables.modelProviderMappingHistoryHourly).values([
			{
				id: "routing-telemetry-a",
				modelId: testModel.id,
				providerId: providerA,
				modelProviderMappingId: `${testModel.id}-${providerA}`,
				hourTimestamp: hour,
				logsCount: 10,
				serviceTierExplicitCount: 2,
				serviceTierImplicitCount: 6,
				serviceTierServedCount: 5,
				serviceTierUnconfirmedCount: 3,
			},
		]);
		await db.insert(tables.routingElectionHourly).values([
			{
				id: "routing-election-scored",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerA,
				selectionReason: "weighted-score",
				requestCount: 2,
				candidateCount: 6,
			},
			{
				id: "routing-election-pinned",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerA,
				selectionReason: "direct-provider-specified",
				requestCount: 8,
				candidateCount: 8,
			},
		]);
		await db.insert(tables.routingExclusionHourly).values([
			{
				id: "routing-exclusion-tier",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerB,
				reason: "service_tier",
				excludedCount: 6,
				candidateCount: 10,
				excludedDecisionCount: 7,
			},
			{
				id: "routing-exclusion-vision",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerB,
				reason: "vision",
				excludedCount: 1,
				candidateCount: 10,
				excludedDecisionCount: 7,
			},
		]);

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.elections.requestCount).toBe(10);
		expect(body.elections.scoredCount).toBe(2);
		// (6 + 8) candidates over 10 requests
		expect(body.elections.averageCandidateCount).toBe(1.4);
		expect(body.elections.byKind).toEqual([
			{ kind: "pinned", requestCount: 8 },
			{ kind: "scored", requestCount: 2 },
		]);

		const telemetryHour = body.hourly.find(
			(h: { hour: string }) => h.hour === hour.toISOString(),
		);
		expect(telemetryHour.elections).toEqual([
			{ kind: "pinned", requestCount: 8 },
			{ kind: "scored", requestCount: 2 },
		]);

		const eligibilityB = body.eligibility.find(
			(e: { providerId: string }) => e.providerId === providerB,
		);
		// 7 of the 10 decisions dropped the mapping, across 2 reasons
		expect(eligibilityB.excludedCount).toBe(7);
		expect(eligibilityB.candidateCount).toBe(10);
		expect(eligibilityB.exclusionRate).toBe(0.7);
		expect(eligibilityB.topReason).toBe("service_tier");

		// A mapping with no exclusion rows reports no rate rather than 0%. The
		// table only carries rows for mappings that were excluded at least once,
		// so this covers both "always eligible" and "no telemetry".
		const eligibilityA = body.eligibility.find(
			(e: { providerId: string }) => e.providerId === providerA,
		);
		expect(eligibilityA.exclusionRate).toBeNull();
		expect(eligibilityA.serviceTier).toEqual({
			requestCount: 10,
			explicit: 2,
			implicit: 6,
			served: 5,
			unconfirmed: 3,
		});

		expect(body.exclusions).toEqual([
			{ reason: "service_tier", excludedCount: 6 },
			{ reason: "vision", excludedCount: 1 },
		]);
		expect(body.serviceTier).toEqual({
			requestCount: 10,
			explicit: 2,
			implicit: 6,
			served: 5,
			unconfirmed: 3,
		});
	});

	it("rates eligibility per decision, not per exclusion reason", async () => {
		const hour = currentHourStart();
		// The mapping was a candidate in 10 decisions and dropped in 5 of them,
		// each time for two reasons at once. Summing the reasons gives 10 and
		// would report the mapping as never once eligible; it served 5 requests.
		await db.insert(tables.routingExclusionHourly).values([
			{
				id: "routing-exclusion-multi-a",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerB,
				reason: "service_tier",
				excludedCount: 5,
				candidateCount: 10,
				excludedDecisionCount: 5,
			},
			{
				id: "routing-exclusion-multi-b",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerB,
				reason: "vision",
				excludedCount: 5,
				candidateCount: 10,
				excludedDecisionCount: 5,
			},
		]);

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		const body = await res.json();
		const eligibilityB = body.eligibility.find(
			(e: { providerId: string }) => e.providerId === providerB,
		);
		expect(eligibilityB.excludedCount).toBe(5);
		expect(eligibilityB.candidateCount).toBe(10);
		expect(eligibilityB.exclusionRate).toBe(0.5);
		// The per-reason breakdown still reports both, and still sums past the
		// decision count — that is the point of keeping the two separate.
		expect(eligibilityB.exclusions).toEqual([
			{ reason: "service_tier", excludedCount: 5 },
			{ reason: "vision", excludedCount: 5 },
		]);
	});

	it("takes the largest candidate count when a bucket disagrees", async () => {
		const hour = currentHourStart();
		// A partially rerun aggregation can leave two reason rows of one
		// mapping-hour carrying different denominators. The query has no ORDER BY,
		// so reading whichever arrives first is non-deterministic.
		await db.insert(tables.routingExclusionHourly).values([
			{
				id: "routing-exclusion-stale",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerB,
				reason: "service_tier",
				excludedCount: 2,
				candidateCount: 4,
				excludedDecisionCount: 2,
			},
			{
				id: "routing-exclusion-fresh",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerB,
				reason: "vision",
				excludedCount: 1,
				candidateCount: 8,
				excludedDecisionCount: 3,
			},
		]);

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		const body = await res.json();
		const eligibilityB = body.eligibility.find(
			(e: { providerId: string }) => e.providerId === providerB,
		);
		expect(eligibilityB.candidateCount).toBe(8);
		expect(eligibilityB.excludedCount).toBe(3);
	});

	it("scores the discounted selection price", async () => {
		const before = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		const baseline = await before.json();
		const baselineA = baseline.mappings.find(
			(m: { providerId: string }) => m.providerId === providerA,
		);

		// Insert through the cached client so its onMutate hook drops the cached
		// discount lookup the baseline request above just populated.
		await cdb.insert(tables.discount).values({
			id: "routing-analytics-discount",
			organizationId: null,
			provider: providerA,
			model: testModel.id,
			discountPercent: "0.25",
		});

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		const body = await res.json();
		const mappingA = body.mappings.find(
			(m: { providerId: string }) => m.providerId === providerA,
		);

		expect(mappingA.discount).toBe(0.25);
		expect(mappingA.listPrice).toBe(baselineA.listPrice);
		expect(mappingA.price).toBeCloseTo(baselineA.listPrice * 0.75, 12);

		// The cheaper price has to move the score the page reports, otherwise it
		// would not be the score that actually elected the provider.
		const summaryA = body.summary.find(
			(s: { providerId: string }) => s.providerId === providerA,
		);
		const baselineSummaryA = baseline.summary.find(
			(s: { providerId: string }) => s.providerId === providerA,
		);
		expect(summaryA.score).toBeLessThanOrEqual(baselineSummaryA.score);
		expect(summaryA.breakdown.priceContribution).toBeLessThanOrEqual(
			baselineSummaryA.breakdown.priceContribution,
		);
	});
});
