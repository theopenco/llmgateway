import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import {
	getCheapestFromAvailableProviders,
	type ProviderSelectionOptions,
} from "@llmgateway/actions";
import { redisClient, waitForSwrMirrorWrites } from "@llmgateway/cache";
import {
	cdb,
	db,
	eq,
	getEffectiveDiscount,
	getProviderMetricsFromHistory,
	getRoutingScoreAdjustment,
	tables,
} from "@llmgateway/db";
import { models, type ProviderModelMapping } from "@llmgateway/models";
import {
	applyRoutingPreference,
	getDefaultRoutingConfig,
} from "@llmgateway/shared/routing-config";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;

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
function isStableTextModel(model: (typeof models)[number]): boolean {
	return (
		!("stability" in model && (model.stability as string) !== "stable") &&
		!(
			"output" in model &&
			(model.output as string[] | undefined)?.includes("image")
		)
	);
}

const testModel = models.find(
	(m) =>
		isStableTextModel(m) && m.providers.filter(isRoutableMapping).length >= 2,
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

function pricesCachedInput(mapping: ProviderModelMapping): boolean {
	return (
		isRoutableMapping(mapping) && Number(mapping.cachedInputPrice ?? 0) > 0
	);
}

// A text model with routable mappings both with and without a cached input
// price: the cache scenarios get an input-side blend, and the DevPass shape
// has a mapping to drop.
const cacheModel = models.find(
	(m) =>
		isStableTextModel(m) &&
		(m.providers as ProviderModelMapping[]).some(pricesCachedInput) &&
		(m.providers as ProviderModelMapping[]).some(
			(p) => isRoutableMapping(p) && !p.cachedInputPrice,
		),
);
const imageModel = models.find(
	(m) =>
		"output" in m &&
		(m.output as string[] | undefined)?.includes("image") &&
		m.providers.some(isRoutableMapping),
);

interface ScenarioResultBody {
	providers: { providerId: string; price: number; score: number }[];
	winnerProviderId: string | null;
	runnerUpProviderId: string | null;
	margin: number | null;
	method: "weighted" | "price-only";
}

interface ScenarioBody {
	id: string;
	effectiveWeights: Record<string, number>;
	cachePricing: { hitRate: number; outputRatio: number } | null;
	hysteresis: boolean;
	excludedProviderIds: string[];
	window: ScenarioResultBody;
	live: ScenarioResultBody;
}

function scenario(body: { scenarios: ScenarioBody[] }, id: string) {
	const found = body.scenarios.find((s) => s.id === id);
	if (!found) {
		throw new Error(`Missing scenario ${id}`);
	}
	return found;
}

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
	let createdTestModel = false;
	let createdProviderA = false;

	beforeEach(async () => {
		createdTestModel = false;
		createdProviderA = false;
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		// Live metrics are SWR-cached by model id, so an earlier run's entry
		// would outlive the history rows it was built from.
		await redisClient.flushdb();
		const insertedModels = await db
			.insert(tables.model)
			.values({
				id: testModel.id,
				name: testModel.name,
				family: testModel.family,
			})
			.onConflictDoNothing()
			.returning({ id: tables.model.id });
		createdTestModel = insertedModels.length > 0;
		const insertedProviders = await db
			.insert(tables.provider)
			.values({
				id: providerA,
				name: providerA,
				description: "test",
			})
			.onConflictDoNothing()
			.returning({ id: tables.provider.id });
		createdProviderA = insertedProviders.length > 0;
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		} else {
			process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
		}
		// None of these tables hang off a cascade root that deleteAll() clears, so
		// the fixtures inserted here have to be removed explicitly or the next run
		// collides on their fixed ids. Discounts go through the cached client so
		// the cached lookup is dropped with them.
		await db.delete(tables.modelProviderMappingHistoryHourly);
		await db.delete(tables.routingElectionHourly);
		await db.delete(tables.routingExclusionHourly);
		await waitForSwrMirrorWrites();
		await db.delete(tables.modelProviderMappingHistory);
		await db.delete(tables.modelProviderMapping);
		await cdb.delete(tables.discount);
		await cdb.delete(tables.routingScoreMultiplier);
		await db
			.delete(tables.model)
			.where(eq(tables.model.id, "routing-airside-model"));
		await db
			.delete(tables.provider)
			.where(eq(tables.provider.id, "routing-airside-carrier"));
		await deleteAll();
		if (createdTestModel) {
			await db.delete(tables.model).where(eq(tables.model.id, testModel.id));
		}
		if (createdProviderA) {
			await db.delete(tables.provider).where(eq(tables.provider.id, providerA));
		}
	});

	it("rejects unauthenticated and non-admin requests", async () => {
		expect((await get(`?modelId=${testModel.id}`)).status).toBe(401);

		process.env.ADMIN_FULL_ACCESS_EMAILS = "someone-else@example.com";
		expect((await get(`?modelId=${testModel.id}`, cookie)).status).toBe(403);
	});

	it("returns 404 for an unknown model", async () => {
		const res = await get("?modelId=does-not-exist", cookie);
		expect(res.status).toBe(404);
	});

	it("excludes an unapproved carrier while retaining its traffic", async () => {
		await db.insert(tables.provider).values({
			id: "routing-airside-carrier",
			name: "Test Airside Carrier",
			description: "test",
		});
		await db.insert(tables.modelProviderMapping).values({
			id: "routing-airside-mapping",
			modelId: testModel.id,
			providerId: "routing-airside-carrier",
			externalId: "upstream-model",
			source: "airside",
			inputPrice: "1e-6",
			outputPrice: "3e-6",
			cachedInputPrice: "0.1e-6",
		});
		await db.insert(tables.modelProviderMappingHistoryHourly).values({
			id: "routing-airside-hour",
			modelId: testModel.id,
			providerId: "routing-airside-carrier",
			modelProviderMappingId: "routing-airside-mapping",
			hourTimestamp: currentHourStart(),
			logsCount: 7,
		});
		const response = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.mappings).toContainEqual(
			expect.objectContaining({
				providerId: "routing-airside-carrier",
				providerName: "Test Airside Carrier",
				listPrice: 2e-6,
				cacheSupported: true,
				routable: false,
				excludedReasons: ["carrier inactive or unapproved"],
			}),
		);
		expect(body.summary).toContainEqual(
			expect.objectContaining({
				providerId: "routing-airside-carrier",
				requestCount: 7,
				score: null,
			}),
		);
		expect(body.hourly.at(-1).providers).toContainEqual(
			expect.objectContaining({
				providerId: "routing-airside-carrier",
				requestCount: 7,
			}),
		);
	});

	it("scores an approved custom carrier without traffic", async () => {
		await db.insert(tables.provider).values({
			id: "routing-airside-carrier",
			name: "Test Airside Carrier",
			description: "test",
		});
		await db
			.insert(tables.providerCompany)
			.values({ id: "routing-company", name: "Test Carrier" });
		await db.insert(tables.providerClaim).values({
			providerCompanyId: "routing-company",
			providerId: "routing-airside-carrier",
			kind: "custom",
			status: "active",
			matchedDomain: "example.com",
			customBaseUrl: "https://example.com",
		});
		await db.insert(tables.modelProviderMapping).values({
			modelId: testModel.id,
			providerId: "routing-airside-carrier",
			externalId: "upstream-model",
			source: "airside",
			inputPrice: "1e-6",
			outputPrice: "3e-6",
		});
		const res = await get(`?modelId=${testModel.id}`, cookie);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.mappings).toContainEqual(
			expect.objectContaining({
				providerId: "routing-airside-carrier",
				routable: true,
				excludedReasons: [],
			}),
		);
	});

	it("uses Airside prices instead of a duplicate static mapping, even without traffic", async () => {
		await db.insert(tables.modelProviderMapping).values({
			id: "routing-airside-override",
			modelId: testModel.id,
			providerId: providerA,
			externalId: "upstream-model",
			source: "airside",
			inputPrice: "1e-6",
			outputPrice: "3e-6",
		});
		let response = await get(`?modelId=${testModel.id}`, cookie);
		expect(response.status).toBe(200);
		let body = await response.json();
		expect(
			body.mappings.filter(
				(mapping: { providerId: string }) => mapping.providerId === providerA,
			),
		).toEqual([expect.objectContaining({ listPrice: 2e-6, routable: true })]);
		expect(body.summary).toContainEqual(
			expect.objectContaining({
				providerId: providerA,
				requestCount: 0,
				score: expect.any(Number),
			}),
		);

		await db
			.update(tables.modelProviderMapping)
			.set({ status: "inactive" })
			.where(eq(tables.modelProviderMapping.id, "routing-airside-override"));
		response = await get(`?modelId=${testModel.id}`, cookie);
		expect(response.status).toBe(200);
		body = await response.json();
		expect(
			body.mappings.filter(
				(mapping: { providerId: string }) => mapping.providerId === providerA,
			),
		).toEqual([
			expect.objectContaining({
				routable: false,
				excludedReasons: ["listing inactive"],
			}),
		]);
	});

	it("supports a model that exists only in Airside", async () => {
		await db.insert(tables.model).values({
			id: "routing-airside-model",
			name: "Test Airside Model",
			family: "test",
		});
		await db.insert(tables.modelProviderMapping).values({
			id: "routing-airside-only",
			modelId: "routing-airside-model",
			providerId: providerA,
			externalId: "upstream-model",
			source: "airside",
			inputPrice: "1e-6",
			outputPrice: "3e-6",
		});
		const response = await get("?modelId=routing-airside-model", cookie);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.model).toMatchObject({
			id: "routing-airside-model",
			family: "test",
		});
		expect(body.mappings).toEqual([
			expect.objectContaining({ providerId: providerA, routable: true }),
		]);
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
				gatewayErrorsCount: 1,
				upstreamErrorsCount: 1,
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
				gatewayErrorsCount: 0,
				upstreamErrorsCount: 0,
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
			{ reason: "service_tier", excludedCount: 6, details: [] },
			{ reason: "vision", excludedCount: 1, details: [] },
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
			{ reason: "service_tier", excludedCount: 5, details: [] },
			{ reason: "vision", excludedCount: 5, details: [] },
		]);
	});

	it("breaks down exclusions on provider ids outside the catalogue", async () => {
		const hour = currentHourStart();
		await db.insert(tables.routingExclusionHourly).values([
			{
				id: "routing-exclusion-custom-json",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: "custom",
				reason: "json_output",
				excludedCount: 4,
				candidateCount: 8,
				excludedDecisionCount: 4,
			},
		]);

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		const body = await res.json();
		expect(body.exclusions).toEqual([
			{ reason: "json_output", excludedCount: 4, details: [] },
		]);
		const eligibilityCustom = body.eligibility.find(
			(e: { providerId: string }) => e.providerId === "custom",
		);
		expect(eligibilityCustom.exclusionRate).toBe(0.5);
		expect(eligibilityCustom.exclusions).toEqual([
			{ reason: "json_output", excludedCount: 4, details: [] },
		]);
	});

	it("nests compliance rules under the compliance total", async () => {
		const hour = currentHourStart();
		// The gateway records the coarse code plus every rule that fired, so the
		// rules must not be listed next to it: summing both double-counts the drop.
		await db.insert(tables.routingExclusionHourly).values([
			{
				id: "routing-exclusion-compliance",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerB,
				reason: "compliance",
				excludedCount: 9,
				candidateCount: 10,
				excludedDecisionCount: 9,
			},
			{
				id: "routing-exclusion-compliance-soc2",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerB,
				reason: "compliance_soc2",
				excludedCount: 9,
				candidateCount: 10,
				excludedDecisionCount: 9,
			},
			{
				id: "routing-exclusion-compliance-gdpr",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerB,
				reason: "compliance_gdpr",
				excludedCount: 4,
				candidateCount: 10,
				excludedDecisionCount: 9,
			},
		]);

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		const body = await res.json();

		expect(body.exclusions).toEqual([
			{
				reason: "compliance",
				excludedCount: 9,
				details: [
					{ reason: "compliance_soc2", excludedCount: 9 },
					{ reason: "compliance_gdpr", excludedCount: 4 },
				],
			},
		]);
		const eligibilityB = body.eligibility.find(
			(e: { providerId: string }) => e.providerId === providerB,
		);
		expect(eligibilityB.topReason).toBe("compliance");
		expect(eligibilityB.exclusions[0].details).toHaveLength(2);
	});

	it("keeps a compliance rule top-level when its parent has no row", async () => {
		const hour = currentHourStart();
		// A partially rerun rollup can leave a detail row without its parent.
		// Attaching it to an invented parent count would report a total nobody
		// measured, so it stays a row of its own.
		await db.insert(tables.routingExclusionHourly).values([
			{
				id: "routing-exclusion-orphan-detail",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerB,
				reason: "compliance_country",
				excludedCount: 3,
				candidateCount: 10,
				excludedDecisionCount: 3,
			},
		]);

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		const body = await res.json();
		expect(body.exclusions).toEqual([
			{ reason: "compliance_country", excludedCount: 3, details: [] },
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

	it("scores the routing score multiplier", async () => {
		const before = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		const baseline = await before.json();
		const [cheapest, other] = (
			baseline.mappings as {
				providerId: string;
				price: number;
				routable: boolean;
			}[]
		)
			.filter((mapping) => mapping.routable && mapping.price > 0)
			.sort((a, b) => a.price - b.price);
		if (!cheapest || !other) {
			throw new Error("Expected two paid, routable mappings");
		}
		const baselineSummaryB = baseline.summary.find(
			(s: { providerId: string }) => s.providerId === other.providerId,
		);

		await cdb.insert(tables.routingScoreMultiplier).values({
			id: "routing-analytics-multiplier",
			provider: cheapest.providerId,
			model: testModel.id,
			scoreMultiplier: "-0.5",
		});

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		const body = await res.json();
		const mappingA = body.mappings.find(
			(m: { providerId: string }) => m.providerId === cheapest.providerId,
		);
		const summaryB = body.summary.find(
			(s: { providerId: string }) => s.providerId === other.providerId,
		);

		// The multiplier only steers routing; the price shown is still billed.
		expect(mappingA.routingAdjustment).toBe(-0.5);
		expect(mappingA.discount).toBe(0);
		// Boosting the cheapest mapping makes the others relatively more expensive.
		expect(summaryB.breakdown.priceContribution).toBeGreaterThan(
			baselineSummaryB.breakdown.priceContribution,
		);
	});
	it("splits election paths per provider", async () => {
		const hour = currentHourStart();
		await db.insert(tables.routingElectionHourly).values([
			{
				id: "routing-election-provider-a-scored",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerA,
				selectionReason: "weighted-score",
				requestCount: 2,
				candidateCount: 4,
			},
			{
				id: "routing-election-provider-a-sticky",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerA,
				selectionReason: "session-sticky",
				requestCount: 8,
				candidateCount: 16,
			},
			{
				id: "routing-election-provider-b-scored",
				hourTimestamp: hour,
				modelId: testModel.id,
				providerId: providerB,
				selectionReason: "weighted-score",
				requestCount: 5,
				candidateCount: 10,
			},
		]);

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.elections.byProvider).toEqual([
			{
				providerId: providerA,
				requestCount: 10,
				byKind: [
					{ kind: "sticky", requestCount: 8 },
					{ kind: "scored", requestCount: 2 },
				],
				byReason: [
					{
						selectionReason: "session-sticky",
						kind: "sticky",
						requestCount: 8,
					},
					{
						selectionReason: "weighted-score",
						kind: "scored",
						requestCount: 2,
					},
				],
			},
			{
				providerId: providerB,
				requestCount: 5,
				byKind: [{ kind: "scored", requestCount: 5 }],
				byReason: [
					{
						selectionReason: "weighted-score",
						kind: "scored",
						requestCount: 5,
					},
				],
			},
		]);

		// The per-provider split partitions the model-wide totals.
		const byProvider = body.elections.byProvider as {
			requestCount: number;
			byKind: { kind: string; requestCount: number }[];
		}[];
		expect(byProvider.reduce((sum, p) => sum + p.requestCount, 0)).toBe(
			body.elections.requestCount,
		);
		for (const { kind, requestCount } of body.elections.byKind as {
			kind: string;
			requestCount: number;
		}[]) {
			const perProvider = byProvider
				.flatMap((p) => p.byKind)
				.filter((entry) => entry.kind === kind)
				.reduce((sum, entry) => sum + entry.requestCount, 0);
			expect(perProvider).toBe(requestCount);
		}
	});

	it("derives window metrics from credit-funded traffic only", async () => {
		const hour = currentHourStart();
		await db.insert(tables.modelProviderMappingHistoryHourly).values([
			{
				id: "routing-analytics-credits",
				modelId: testModel.id,
				providerId: providerA,
				modelProviderMappingId: `${testModel.id}-${providerA}`,
				usedMode: "credits",
				hourTimestamp: hour,
				logsCount: 10,
				errorsCount: 1,
				upstreamErrorsCount: 1,
			},
			// A customer's own key failing auth is not the platform's uptime.
			{
				id: "routing-analytics-byok",
				modelId: testModel.id,
				providerId: providerA,
				modelProviderMappingId: `${testModel.id}-${providerA}`,
				usedMode: "api-keys",
				hourTimestamp: hour,
				logsCount: 30,
				errorsCount: 30,
				gatewayErrorsCount: 30,
			},
		]);

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		expect(res.status).toBe(200);
		const body = await res.json();

		const summaryA = body.summary.find(
			(s: { providerId: string }) => s.providerId === providerA,
		);
		expect(summaryA.requestCount).toBe(40);
		expect(summaryA.errorCount).toBe(1);
		expect(summaryA.uptime).toBe(90);
		expect(summaryA.breakdown.uptimePenalty).toBeGreaterThan(0);

		const entryA = body.hourly
			.find((h: { hour: string }) => h.hour === hour.toISOString())
			.providers.find(
				(p: { providerId: string }) => p.providerId === providerA,
			);
		expect(entryA.requestCount).toBe(40);
		expect(entryA.errorCount).toBe(1);
		expect(entryA.uptime).toBe(90);
	});

	it("reads live metrics from credit-funded minute history only", async () => {
		const tenMinutesMs = 10 * 60_000;
		const minute = new Date(Date.now() - tenMinutesMs);
		minute.setUTCSeconds(0, 0);
		await db.insert(tables.modelProviderMappingHistory).values([
			{
				modelId: testModel.id,
				providerId: providerA,
				modelProviderMappingId: `${testModel.id}-${providerA}`,
				usedMode: "credits",
				minuteTimestamp: minute,
				logsCount: 10,
				errorsCount: 2,
				upstreamErrorsCount: 2,
				totalOutputTokens: 4000,
				totalDuration: 8000,
				totalTimeToFirstToken: 3000,
				timeToFirstTokenCount: 10,
			},
			// BYOK traffic does not represent the credentials routing selects.
			{
				modelId: testModel.id,
				providerId: providerB,
				modelProviderMappingId: `${testModel.id}-${providerB}`,
				usedMode: "api-keys",
				minuteTimestamp: minute,
				logsCount: 10,
			},
		]);

		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.live.windowMinutes).toBe(body.config.history.windowMinutes);
		const liveA = body.live.providers.find(
			(p: { providerId: string }) => p.providerId === providerA,
		);
		expect(liveA.sampleRequests).toBe(10);
		expect(liveA.uptime).toBeCloseTo(80, 2);
		expect(liveA.latency).toBe(300);
		expect(liveA.throughput).toBe(500);

		const liveB = body.live.providers.find(
			(p: { providerId: string }) => p.providerId === providerB,
		);
		expect(liveB).toEqual({
			providerId: providerB,
			uptime: null,
			latency: null,
			throughput: null,
			sampleRequests: 0,
		});

		// The live source scores those inputs: A carries the uptime penalty.
		const live = scenario(body, "streaming").live;
		const scoredA = live.providers.find((p) => p.providerId === providerA)!;
		const window = scenario(body, "streaming").window;
		const windowA = window.providers.find((p) => p.providerId === providerA)!;
		expect(scoredA.score).toBeGreaterThan(windowA.score);
	});

	it("scores every request shape the router distinguishes", async () => {
		const res = await get(`?modelId=${testModel.id}&window=24h`, cookie);
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.config.sticky.scoreMargin).toBeGreaterThan(0);
		expect(body.scenarios.map((s: ScenarioBody) => s.id)).toEqual([
			"streaming",
			"non-streaming",
			"cached-api",
			"coding-session",
			"chat-session",
			"price",
			"throughput",
			"latency",
		]);

		expect(scenario(body, "non-streaming").effectiveWeights.latency).toBe(0);
		expect(
			scenario(body, "streaming").effectiveWeights.latency,
		).toBeGreaterThan(0);
		const price = scenario(body, "price").effectiveWeights;
		expect(price.price / price.total).toBeCloseTo(0.9, 6);
		expect(price.uptime / price.total).toBeCloseTo(0.1, 6);
		expect(scenario(body, "streaming").cachePricing).toBeNull();
		expect(scenario(body, "coding-session").cachePricing).toEqual({
			hitRate: 0.9,
			outputRatio: 0.02,
		});

		const streaming = scenario(body, "streaming");
		const summaryScores = new Map(
			(body.summary as { providerId: string; score: number | null }[]).map(
				(s) => [s.providerId, s.score],
			),
		);
		for (const s of body.scenarios as ScenarioBody[]) {
			for (const result of [s.window, s.live]) {
				const scores = result.providers.map((p) => p.score);
				expect(scores).toEqual([...scores].sort((a, b) => a - b));
				expect(result.winnerProviderId).toBe(
					result.providers[0]?.providerId ?? null,
				);
				expect(result.runnerUpProviderId).toBe(
					result.providers[1]?.providerId ?? null,
				);
				if (result.margin !== null) {
					expect(result.margin).toBeGreaterThanOrEqual(0);
				}
			}
		}
		// The default shape on window averages is the summary score.
		for (const entry of streaming.window.providers) {
			expect(entry.score).toBe(summaryScores.get(entry.providerId));
		}
	});

	it("prices cached input into the cache scenarios", async () => {
		if (!cacheModel) {
			throw new Error(
				"No catalogue model prices cached input; update this fixture.",
			);
		}
		const res = await get(`?modelId=${cacheModel.id}&window=24h`, cookie);
		expect(res.status).toBe(200);
		const body = await res.json();

		const cachedProvider = (
			cacheModel.providers as ProviderModelMapping[]
		).find(pricesCachedInput)!.providerId;
		const priceIn = (id: string) =>
			scenario(body, id).window.providers.find(
				(p) => p.providerId === cachedProvider,
			)!.price;
		expect(priceIn("coding-session")).toBeLessThan(priceIn("streaming"));
	});

	it("scores image models on the image price weight", async () => {
		if (!imageModel) {
			throw new Error(
				"No routable image model in the catalogue; update this fixture.",
			);
		}
		const res = await get(`?modelId=${imageModel.id}&window=24h`, cookie);
		expect(res.status).toBe(200);
		const body = await res.json();

		// Large prompts and sessions price cache reads for image models too.
		expect(body.scenarios.map((s: ScenarioBody) => s.id)).toContain(
			"cached-api",
		);
		const weights = scenario(body, "streaming").effectiveWeights;
		expect(weights.price).toBe(body.config.weights.imagePrice);
	});

	it("drops mappings without a cached input price from the DevPass shape", async () => {
		if (!cacheModel) {
			throw new Error(
				"No catalogue model mixes cached and uncached mappings; update this fixture.",
			);
		}
		const res = await get(`?modelId=${cacheModel.id}&window=24h`, cookie);
		expect(res.status).toBe(200);
		const body = await res.json();

		const uncached = (cacheModel.providers as ProviderModelMapping[]).find(
			(p) => isRoutableMapping(p) && !p.cachedInputPrice,
		)!.providerId;
		const devpass = scenario(body, "coding-session");
		expect(devpass.excludedProviderIds).toContain(uncached);
		expect(devpass.live.providers.map((p) => p.providerId)).not.toContain(
			uncached,
		);
		expect(scenario(body, "streaming").excludedProviderIds).toEqual([]);

		// Sessions pin per session, so org-level hysteresis does not apply.
		expect(devpass.hysteresis).toBe(false);
		expect(scenario(body, "chat-session").hysteresis).toBe(false);
		expect(scenario(body, "streaming").hysteresis).toBe(true);
	});

	it("names the provider the gateway elects for every request shape", async () => {
		if (!cacheModel) {
			throw new Error(
				"No catalogue model mixes cached and uncached mappings; update this fixture.",
			);
		}
		const routable = (cacheModel.providers as ProviderModelMapping[]).filter(
			isRoutableMapping,
		);

		async function assertParity(expectedMethod: "weighted" | "price-only") {
			await redisClient.flushdb();
			const res = await get(`?modelId=${cacheModel!.id}&window=24h`, cookie);
			expect(res.status).toBe(200);
			const body = await res.json();
			const routableIds = new Set(
				(body.mappings as { providerId: string; routable: boolean }[])
					.filter((m) => m.routable)
					.map((m) => m.providerId),
			);
			const candidates = routable
				.filter((p) => routableIds.has(p.providerId))
				.map((p) => ({ providerId: p.providerId, externalId: p.externalId }));
			const defaults = getDefaultRoutingConfig();
			const metricsMap = await getProviderMetricsFromHistory(
				candidates.map((p) => ({
					modelId: cacheModel!.id,
					providerId: p.providerId,
				})),
				defaults.history,
			);
			const shared: ProviderSelectionOptions = {
				metricsMap,
				providerDiscountResolver: async (provider, modelId) =>
					(await getEffectiveDiscount(null, provider.providerId, modelId))
						.discount,
				providerRoutingScoreMultiplierResolver: async (provider, modelId) =>
					await getRoutingScoreAdjustment(provider.providerId, modelId),
			};
			const shapes: Record<
				string,
				{ options: ProviderSelectionOptions; cachedOnly?: boolean }
			> = {
				streaming: { options: { isStreaming: true } },
				"non-streaming": { options: { isStreaming: false } },
				"cached-api": { options: { isStreaming: true, promptTokens: 10_000 } },
				"chat-session": {
					options: {
						isStreaming: true,
						session: true,
						routingConfig: getDefaultRoutingConfig("chat"),
					},
				},
				"coding-session": {
					cachedOnly: true,
					options: {
						isStreaming: true,
						session: true,
						routingConfig: getDefaultRoutingConfig("devpass"),
					},
				},
				price: {
					options: {
						isStreaming: true,
						routingConfig: applyRoutingPreference(defaults, "price"),
					},
				},
				throughput: {
					options: {
						isStreaming: true,
						routingConfig: applyRoutingPreference(defaults, "throughput"),
					},
				},
				latency: {
					options: {
						isStreaming: true,
						routingConfig: applyRoutingPreference(defaults, "latency"),
					},
				},
			};
			for (const [id, shape] of Object.entries(shapes)) {
				const shapeCandidates = shape.cachedOnly
					? candidates.filter((p) =>
							routable.some(
								(m) => m.providerId === p.providerId && m.cachedInputPrice,
							),
						)
					: candidates;
				const selected = await getCheapestFromAvailableProviders(
					shapeCandidates,
					cacheModel!,
					{ ...shared, ...shape.options },
				);
				const live = scenario(body, id).live;
				expect(live.method, id).toBe(expectedMethod);
				expect(live.winnerProviderId, id).toBe(
					selected?.provider.providerId ?? null,
				);
			}
		}

		await assertParity("price-only");

		const threeMinutesMs = 3 * 60_000;
		const minute = new Date(Date.now() - threeMinutesMs);
		minute.setUTCSeconds(0, 0);
		await db.insert(tables.modelProviderMappingHistory).values(
			routable.map((p, index) => {
				const ttftStepMs = 150 * index;
				const ttftMs = 300 + ttftStepMs;
				return {
					modelId: cacheModel.id,
					providerId: p.providerId,
					modelProviderMappingId: `${cacheModel.id}-${p.providerId}`,
					usedMode: "credits" as const,
					minuteTimestamp: minute,
					logsCount: 20,
					// Spread uptime, speed and TTFT so the factors pull different ways.
					upstreamErrorsCount: index % 3,
					totalOutputTokens: 4000 * (index + 1),
					totalDuration: 20_000,
					totalTimeToFirstToken: 20 * ttftMs,
					timeToFirstTokenCount: 20,
				};
			}),
		);
		await assertParity("weighted");
	});
});
