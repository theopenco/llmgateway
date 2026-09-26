import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const PROVIDER_ID = "load-provider";
const MODEL_ID = "load-model";
const ROOT_MAPPING_ID = "load-mapping-root";
const REGIONAL_MAPPING_ID = "load-mapping-regional";

const ORG_A = "load-org-a";
const ORG_B = "load-org-b";
const PROJECT_A = "load-project-a";
const PROJECT_B = "load-project-b";
const API_KEY_A = "load-key-a";
const API_KEY_B = "load-key-b";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function floorTo(date: Date, ms: number): Date {
	return new Date(Math.floor(date.getTime() / ms) * ms);
}

interface LoadOverview {
	window: string;
	bucket: "minute" | "hour" | "day";
	source: "mapping-history" | "project-stats";
	groupBy: string;
	summary: {
		currentRps: number;
		currentSeconds: number;
		avgRps: number;
		peakRps: number;
		peakAt: string | null;
		totalRequests: number;
		errorRate: number | null;
	};
	series: { key: string; label: string }[];
	data: {
		timestamp: string;
		partial: boolean;
		bucketSeconds: number;
		requestCount: number;
		rps: number;
		entries: { key: string; requestCount: number; rps: number }[];
	}[];
	breakdown: {
		key: string;
		label: string;
		requestCount: number;
		avgRps: number;
		peakRps: number;
		share: number;
		errorRate: number | null;
	}[];
	totalKeys: number;
}

async function fetchLoad(
	cookie: string,
	query: Record<string, string> = {},
): Promise<LoadOverview> {
	const params = new URLSearchParams(query);
	const res = await app.request(`/admin/load/overview?${params.toString()}`, {
		headers: { Cookie: cookie },
	});
	expect(res.status).toBe(200);
	return (await res.json()) as LoadOverview;
}

// `deleteAll()` does not cover the catalogue or the minute-grain history, so
// this suite owns that cleanup, scoped to its own fixture ids.
const clearCatalogFixtures = async () => {
	await db
		.delete(tables.modelProviderMappingHistory)
		.where(eq(tables.modelProviderMappingHistory.modelId, MODEL_ID));
	await db
		.delete(tables.modelProviderMapping)
		.where(eq(tables.modelProviderMapping.modelId, MODEL_ID));
	await db.delete(tables.model).where(eq(tables.model.id, MODEL_ID));
	await db.delete(tables.provider).where(eq(tables.provider.id, PROVIDER_ID));
};

describe("admin — gateway load", () => {
	let cookie: string;
	let closedMinute: Date;
	let currentMinute: Date;
	let closedHour: Date;
	let currentHour: Date;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await clearCatalogFixtures();

		const now = new Date();
		currentMinute = floorTo(now, MINUTE_MS);
		closedMinute = new Date(currentMinute.getTime() - MINUTE_MS);
		currentHour = floorTo(now, HOUR_MS);
		closedHour = new Date(currentHour.getTime() - HOUR_MS);

		await db.insert(tables.provider).values({
			id: PROVIDER_ID,
			name: "Load Provider",
			description: "Load test provider",
		});
		await db.insert(tables.model).values({
			id: MODEL_ID,
			name: "Load Model",
			family: "load",
		});
		await db.insert(tables.modelProviderMapping).values([
			{
				id: ROOT_MAPPING_ID,
				modelId: MODEL_ID,
				providerId: PROVIDER_ID,
				externalId: MODEL_ID,
			},
			{
				id: REGIONAL_MAPPING_ID,
				modelId: MODEL_ID,
				providerId: PROVIDER_ID,
				externalId: MODEL_ID,
				region: "us-east",
			},
		]);

		await db.insert(tables.modelProviderMappingHistory).values([
			{
				modelId: MODEL_ID,
				providerId: PROVIDER_ID,
				modelProviderMappingId: ROOT_MAPPING_ID,
				usedMode: "credits",
				minuteTimestamp: closedMinute,
				logsCount: 120,
				errorsCount: 12,
			},
			{
				modelId: MODEL_ID,
				providerId: PROVIDER_ID,
				modelProviderMappingId: ROOT_MAPPING_ID,
				usedMode: "credits",
				minuteTimestamp: currentMinute,
				logsCount: 30,
			},
			// The aggregator already merged this regional row's traffic into the
			// root row above; counting it again doubles the provider.
			{
				modelId: MODEL_ID,
				providerId: PROVIDER_ID,
				modelProviderMappingId: REGIONAL_MAPPING_ID,
				usedMode: "credits",
				minuteTimestamp: closedMinute,
				logsCount: 90,
			},
		]);

		await db.insert(tables.organization).values([
			{ id: ORG_A, name: "Load Org A", billingEmail: "load-a@example.com" },
			{ id: ORG_B, name: "Load Org B", billingEmail: "load-b@example.com" },
		]);
		await db.insert(tables.project).values([
			{ id: PROJECT_A, name: "Load Project A", organizationId: ORG_A },
			{ id: PROJECT_B, name: "Load Project B", organizationId: ORG_B },
		]);
		await db.insert(tables.apiKey).values([
			{
				id: API_KEY_A,
				...hashApiKeyForStorage("load-token-a"),
				projectId: PROJECT_A,
				description: "Load Key A",
				createdBy: "test-user-id",
			},
			{
				id: API_KEY_B,
				...hashApiKeyForStorage("load-token-b"),
				projectId: PROJECT_B,
				description: "Load Key B",
				createdBy: "test-user-id",
			},
		]);

		await db.insert(tables.projectHourlyStats).values([
			{
				projectId: PROJECT_A,
				hourTimestamp: closedHour,
				requestCount: 7200,
				errorCount: 72,
				creditsRequestCount: 7200,
			},
			{
				projectId: PROJECT_B,
				hourTimestamp: closedHour,
				requestCount: 1800,
				errorCount: 0,
				creditsRequestCount: 900,
				apiKeysRequestCount: 900,
			},
		]);
		await db.insert(tables.apiKeyHourlyStats).values([
			{
				apiKeyId: API_KEY_A,
				projectId: PROJECT_A,
				hourTimestamp: closedHour,
				requestCount: 7200,
				errorCount: 72,
				creditsRequestCount: 7200,
			},
			{
				apiKeyId: API_KEY_B,
				projectId: PROJECT_B,
				hourTimestamp: closedHour,
				requestCount: 1800,
				creditsRequestCount: 900,
				apiKeysRequestCount: 900,
			},
		]);
		await db.insert(tables.apiKeyHourlyModelStats).values([
			{
				apiKeyId: API_KEY_A,
				projectId: PROJECT_A,
				hourTimestamp: closedHour,
				usedModel: `${PROVIDER_ID}/${MODEL_ID}`,
				usedProvider: PROVIDER_ID,
				requestCount: 5400,
				creditsRequestCount: 5400,
			},
			{
				apiKeyId: API_KEY_A,
				projectId: PROJECT_A,
				hourTimestamp: closedHour,
				usedModel: `${PROVIDER_ID}/${MODEL_ID}:us-east`,
				usedProvider: PROVIDER_ID,
				requestCount: 1800,
				creditsRequestCount: 1800,
			},
		]);
		await db.insert(tables.projectHourlyModelStats).values([
			{
				projectId: PROJECT_A,
				hourTimestamp: closedHour,
				usedModel: `${PROVIDER_ID}/${MODEL_ID}`,
				usedProvider: PROVIDER_ID,
				requestCount: 5400,
				creditsRequestCount: 5400,
			},
			{
				projectId: PROJECT_A,
				hourTimestamp: closedHour,
				usedModel: `${PROVIDER_ID}/${MODEL_ID}:us-east`,
				usedProvider: PROVIDER_ID,
				requestCount: 1800,
				creditsRequestCount: 1800,
			},
		]);
	});

	afterEach(async () => {
		await clearCatalogFixtures();
		await deleteAll();
	});

	test("rejects a non-admin session", async () => {
		process.env.ADMIN_EMAILS = "someone-else@example.com";
		const res = await app.request("/admin/load/overview", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(403);
	});

	test("serves the model axis from the minute-grain mapping history", async () => {
		const body = await fetchLoad(cookie, { window: "1h", groupBy: "model" });

		expect(body.source).toBe("mapping-history");
		expect(body.bucket).toBe("minute");
		expect(body.series).toEqual([{ key: MODEL_ID, label: MODEL_ID }]);

		const closed = body.data.find(
			(point) =>
				point.timestamp === closedMinute.toISOString().replace(".000", ""),
		);
		expect(closed).toBeDefined();
		expect(closed?.partial).toBe(false);
		expect(closed?.bucketSeconds).toBe(60);
		// 120 requests in a closed minute, and the regional row is excluded.
		expect(closed?.requestCount).toBe(120);
		expect(closed?.rps).toBeCloseTo(2, 6);
	});

	test("normalizes the in-progress bucket by its elapsed seconds", async () => {
		const body = await fetchLoad(cookie, { window: "1h", groupBy: "model" });

		const partial = body.data.at(-1);
		expect(partial?.partial).toBe(true);
		expect(partial?.bucketSeconds).toBeLessThanOrEqual(60);
		expect(partial?.bucketSeconds).toBeGreaterThan(0);
		// Dividing the still-filling bucket by the full 60s would report a rate
		// below the closed minute's; normalizing keeps it comparable.
		expect(partial?.rps).toBeCloseTo(30 / (partial?.bucketSeconds ?? 60), 6);
	});

	test("averages the current rate over a trailing window and ignores partials for the peak", async () => {
		const body = await fetchLoad(cookie, { window: "1h", groupBy: "model" });

		// 120 requests spread over the last five settled minutes — a single
		// empty minute must not drop the headline reading to zero.
		expect(body.summary.currentSeconds).toBe(300);
		expect(body.summary.currentRps).toBeCloseTo(120 / 300, 6);
		expect(body.summary.peakRps).toBeCloseTo(2, 6);
		expect(body.summary.peakAt).toBe(
			closedMinute.toISOString().replace(".000", ""),
		);
		expect(body.summary.totalRequests).toBe(150);
		expect(body.summary.errorRate).toBeCloseTo(12 / 150, 6);
	});

	test("excludes regional mapping rows from the provider axis", async () => {
		const body = await fetchLoad(cookie, { window: "1h", groupBy: "provider" });

		expect(body.source).toBe("mapping-history");
		expect(body.breakdown).toEqual([
			expect.objectContaining({
				key: PROVIDER_ID,
				label: "Load Provider",
				requestCount: 150,
			}),
		]);
	});

	test("narrows the mapping history to a billing mode", async () => {
		const body = await fetchLoad(cookie, {
			window: "1h",
			groupBy: "model",
			mode: "api-keys",
		});
		// Every fixture minute row is credits traffic.
		expect(body.summary.totalRequests).toBe(0);
		expect(body.breakdown).toEqual([]);
		expect(body.series).toEqual([]);
	});

	test("withholds the error rate when a mode narrows the tenant rollup", async () => {
		const total = await fetchLoad(cookie, {
			window: "1d",
			groupBy: "organization",
		});
		expect(total.summary.errorRate).toBeCloseTo(72 / 9000, 6);

		const credits = await fetchLoad(cookie, {
			window: "1d",
			groupBy: "organization",
			mode: "credits",
		});
		// The per-mode request columns have no matching error split.
		expect(credits.summary.errorRate).toBeNull();
	});

	test("ranks organizations from the project rollup", async () => {
		const body = await fetchLoad(cookie, {
			window: "1d",
			groupBy: "organization",
		});

		expect(body.source).toBe("project-stats");
		expect(body.bucket).toBe("hour");
		expect(body.breakdown.map((row) => [row.key, row.requestCount])).toEqual([
			[ORG_A, 7200],
			[ORG_B, 1800],
		]);
		expect(body.breakdown[0].label).toBe("Load Org A");
		// 7200 requests inside one closed hour.
		expect(body.breakdown[0].peakRps).toBeCloseTo(2, 6);
		expect(body.breakdown[0].share).toBeCloseTo(0.8, 6);
	});

	test("applies the per-mode request columns on the tenant axis", async () => {
		const body = await fetchLoad(cookie, {
			window: "1d",
			groupBy: "organization",
			mode: "api-keys",
		});
		expect(body.breakdown).toEqual([
			expect.objectContaining({ key: ORG_B, requestCount: 900 }),
		]);
	});

	test("an organization filter forces the hourly tenant source even on the model axis", async () => {
		const body = await fetchLoad(cookie, {
			window: "1h",
			groupBy: "model",
			organizationId: ORG_A,
		});
		expect(body.source).toBe("project-stats");
		// Minute grain does not exist per tenant, so the request is upgraded.
		expect(body.bucket).toBe("hour");
	});

	test("keeps the API key filter on the table it is querying", async () => {
		// groupBy=model under an API key filter reads api_key_hourly_model_stats;
		// filtering on the plain api-key table would reference a table that is
		// not in the FROM clause.
		const body = await fetchLoad(cookie, {
			window: "1d",
			groupBy: "model",
			apiKeyId: API_KEY_A,
		});
		expect(body.source).toBe("project-stats");
		// The regional variant collapses into the canonical catalogue id.
		expect(body.breakdown).toEqual([
			expect.objectContaining({ key: MODEL_ID, requestCount: 7200 }),
		]);
	});

	test("collapses regional model variants in the canonical view", async () => {
		const canonical = await fetchLoad(cookie, {
			window: "1d",
			groupBy: "model",
			projectId: PROJECT_A,
		});
		expect(canonical.breakdown).toEqual([
			expect.objectContaining({ key: MODEL_ID, requestCount: 7200 }),
		]);

		const mappings = await fetchLoad(cookie, {
			window: "1d",
			groupBy: "model",
			modelView: "mapping",
			projectId: PROJECT_A,
		});
		expect(
			mappings.breakdown.map((row) => [row.key, row.requestCount]),
		).toEqual([
			[`${PROVIDER_ID}/${MODEL_ID}`, 5400],
			[`${PROVIDER_ID}/${MODEL_ID}:us-east`, 1800],
		]);
	});

	test("filters to a single project and to a single API key", async () => {
		const byProject = await fetchLoad(cookie, {
			window: "1d",
			groupBy: "project",
			projectId: PROJECT_B,
		});
		expect(byProject.breakdown).toEqual([
			expect.objectContaining({ key: PROJECT_B, requestCount: 1800 }),
		]);

		const byKey = await fetchLoad(cookie, {
			window: "1d",
			groupBy: "api-key",
			apiKeyId: API_KEY_A,
		});
		expect(byKey.breakdown).toEqual([
			expect.objectContaining({
				key: API_KEY_A,
				label: "Load Key A",
				requestCount: 7200,
			}),
		]);
	});

	test("searches the filter options across every organization", async () => {
		const res = await app.request(
			"/admin/load/filter-options?type=organization&q=Load%20Org%20B",
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			options: { id: string; label: string; sublabel: string | null }[];
		};
		expect(body.options).toEqual([
			{ id: ORG_B, label: "Load Org B", sublabel: "load-b@example.com" },
		]);
	});

	test("resolves a selected filter option by id", async () => {
		const res = await app.request(
			`/admin/load/filter-options?type=api-key&id=${API_KEY_A}`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			options: { id: string; label: string; sublabel: string | null }[];
		};
		expect(body.options).toEqual([
			{
				id: API_KEY_A,
				label: "Load Key A",
				sublabel: "Load Org A / Load Project A",
			},
		]);
	});
});
