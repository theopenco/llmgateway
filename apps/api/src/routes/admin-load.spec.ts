import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
		clientErrorRate: number | null;
		errorCount: number | null;
		clientErrorCount: number | null;
		avgDurationMs: number | null;
		avgTimeToFirstTokenMs: number | null;
	};
	series: { key: string; label: string }[];
	data: {
		timestamp: string;
		partial: boolean;
		bucketSeconds: number;
		requestCount: number;
		rps: number;
		avgDurationMs: number | null;
		avgTimeToFirstTokenMs: number | null;
		errorRate: number | null;
		clientErrorRate: number | null;
		entries: {
			key: string;
			requestCount: number;
			rps: number;
			avgDurationMs: number | null;
			avgTimeToFirstTokenMs: number | null;
			errorRate: number | null;
			clientErrorRate: number | null;
		}[];
	}[];
	breakdown: {
		key: string;
		label: string;
		requestCount: number;
		avgRps: number;
		peakRps: number;
		share: number;
		errorRate: number | null;
		clientErrorRate: number | null;
		errorCount: number | null;
		clientErrorCount: number | null;
		avgDurationMs: number | null;
		avgTimeToFirstTokenMs: number | null;
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
	let leadingMinute: Date;
	let closedHour: Date;
	let currentHour: Date;

	beforeEach(async () => {
		// The fixtures are anchored to the current minute and hour, and the
		// handler reads its own clock a second or two later. Without pinning, a
		// minute boundary crossing mid-test turns the in-progress bucket into a
		// settled one and every rate assertion shifts. Pinning mid-minute keeps
		// the two in agreement; only `Date` is faked, so the pg driver's timers
		// keep running.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(
			new Date(floorTo(new Date(), MINUTE_MS).getTime() + 30_000),
		);

		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await clearCatalogFixtures();

		const now = new Date();
		currentMinute = floorTo(now, MINUTE_MS);
		closedMinute = new Date(currentMinute.getTime() - MINUTE_MS);
		const windowStartMs = now.getTime() - HOUR_MS;
		leadingMinute = floorTo(new Date(windowStartMs), MINUTE_MS);
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
			// The first minute the 1h window covers. Its row is stamped at the
			// floor of the bucket, which is earlier than `now - 1h`.
			{
				modelId: MODEL_ID,
				providerId: PROVIDER_ID,
				modelProviderMappingId: ROOT_MAPPING_ID,
				usedMode: "credits",
				minuteTimestamp: leadingMinute,
				logsCount: 60,
			},
			{
				modelId: MODEL_ID,
				providerId: PROVIDER_ID,
				modelProviderMappingId: ROOT_MAPPING_ID,
				usedMode: "credits",
				minuteTimestamp: closedMinute,
				logsCount: 120,
				errorsCount: 12,
				clientErrorsCount: 2,
				gatewayErrorsCount: 2,
				upstreamErrorsCount: 8,
				totalDuration: 120 * 800,
				totalTimeToFirstToken: 60 * 250,
				timeToFirstTokenCount: 60,
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
				clientErrorCount: 12,
				upstreamErrorCount: 60,
				creditsRequestCount: 7200,
				totalDuration: 7200 * 1500,
				durationCount: 7200,
				totalTimeToFirstToken: 3600 * 400,
				timeToFirstTokenCount: 3600,
			},
			// Deliberately left without latency samples: this is what a bucket
			// aggregated before the latency columns existed looks like, and it
			// must read as "unknown", not as 0 ms.
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
				clientErrorCount: 12,
				upstreamErrorCount: 60,
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
				errorCount: 60,
				clientErrorCount: 6,
				upstreamErrorCount: 54,
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
				errorCount: 60,
				clientErrorCount: 6,
				upstreamErrorCount: 54,
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
		vi.useRealTimers();
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
		expect(body.summary.totalRequests).toBe(210);
		// Gateway + upstream errors over the non-client requests; the caller's
		// own mistakes are reported on their own.
		expect(body.summary.errorRate).toBeCloseTo(10 / 208, 6);
		expect(body.summary.clientErrorRate).toBeCloseTo(2 / 210, 6);
		expect(body.summary.errorCount).toBe(10);
		expect(body.summary.clientErrorCount).toBe(2);
	});

	test("counts the bucket the window opens in", async () => {
		const body = await fetchLoad(cookie, { window: "1h", groupBy: "model" });

		// The grid starts at the floor of `now - 1h`, so the range filter has to
		// start there too — otherwise the first point is permanently zero.
		const first = body.data[0];
		expect(first.timestamp).toBe(
			leadingMinute.toISOString().replace(".000", ""),
		);
		expect(first.requestCount).toBe(60);
		expect(first.rps).toBeCloseTo(1, 6);
	});

	test("excludes regional mapping rows from the provider axis", async () => {
		const body = await fetchLoad(cookie, { window: "1h", groupBy: "provider" });

		expect(body.source).toBe("mapping-history");
		expect(body.breakdown).toEqual([
			expect.objectContaining({
				key: PROVIDER_ID,
				label: "Load Provider",
				requestCount: 210,
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
		expect(total.summary.errorRate).toBeCloseTo(60 / (9000 - 12), 6);
		expect(total.summary.clientErrorRate).toBeCloseTo(12 / 9000, 6);

		const credits = await fetchLoad(cookie, {
			window: "1d",
			groupBy: "organization",
			mode: "credits",
		});
		// The per-mode request columns have no matching error split.
		expect(credits.summary.errorRate).toBeNull();
		expect(credits.summary.clientErrorRate).toBeNull();
		expect(credits.summary.errorCount).toBeNull();
		expect(credits.breakdown.every((row) => row.errorRate === null)).toBe(true);
	});

	test("keeps the error rate exact when a mode narrows the mapping history", async () => {
		// The mapping history keys on `used_mode`, so its error split is per mode.
		const body = await fetchLoad(cookie, {
			window: "1h",
			groupBy: "model",
			mode: "credits",
		});
		expect(body.summary.errorRate).toBeCloseTo(10 / 208, 6);
	});

	test("reports the error rate per bucket and per series", async () => {
		const body = await fetchLoad(cookie, { window: "1h", groupBy: "model" });

		const closed = body.data.find(
			(point) =>
				point.timestamp === closedMinute.toISOString().replace(".000", ""),
		);
		expect(closed?.errorRate).toBeCloseTo(10 / 118, 6);
		expect(closed?.clientErrorRate).toBeCloseTo(2 / 120, 6);
		expect(closed?.entries[0].errorRate).toBeCloseTo(10 / 118, 6);

		// A bucket with traffic but no failures is a real 0%.
		expect(body.data[0].errorRate).toBe(0);
		// A bucket with no traffic is a gap, not 0%.
		const empty = body.data.find(
			(point) => point.requestCount === 0 && !point.partial,
		);
		expect(empty?.errorRate).toBeNull();
		expect(empty?.entries[0].errorRate).toBeNull();
	});

	test("reports the model error rate under an organization, project or API key filter", async () => {
		const filters: Record<string, string>[] = [
			{ organizationId: ORG_A },
			{ projectId: PROJECT_A },
			{ apiKeyId: API_KEY_A },
		];
		for (const filter of filters) {
			const body = await fetchLoad(cookie, {
				window: "1d",
				groupBy: "model",
				modelView: "mapping",
				...filter,
			});
			const root = body.breakdown.find(
				(row) => row.key === `${PROVIDER_ID}/${MODEL_ID}`,
			);
			expect(root?.errorRate).toBeCloseTo(54 / (5400 - 6), 6);
			expect(root?.clientErrorRate).toBeCloseTo(6 / 5400, 6);
			const regional = body.breakdown.find(
				(row) => row.key === `${PROVIDER_ID}/${MODEL_ID}:us-east`,
			);
			expect(regional?.errorRate).toBe(0);
		}
	});

	test("ranks series by error count on request", async () => {
		const flakyModel = `${PROVIDER_ID}/load-flaky`;
		await db.insert(tables.projectHourlyModelStats).values({
			projectId: PROJECT_A,
			hourTimestamp: closedHour,
			usedModel: flakyModel,
			usedProvider: PROVIDER_ID,
			requestCount: 100,
			creditsRequestCount: 100,
			errorCount: 80,
			upstreamErrorCount: 80,
		});
		const query = {
			window: "1d",
			groupBy: "model",
			modelView: "mapping",
			organizationId: ORG_A,
		};

		const byRequests = await fetchLoad(cookie, query);
		expect(byRequests.breakdown.map((row) => row.key)).toEqual([
			`${PROVIDER_ID}/${MODEL_ID}`,
			`${PROVIDER_ID}/${MODEL_ID}:us-east`,
			flakyModel,
		]);

		// 80 failures outrank 54 on far more traffic; the error-free regional
		// mapping falls back to request order behind both.
		const byErrors = await fetchLoad(cookie, { ...query, rankBy: "errors" });
		expect(byErrors.breakdown.map((row) => row.key)).toEqual([
			flakyModel,
			`${PROVIDER_ID}/${MODEL_ID}`,
			`${PROVIDER_ID}/${MODEL_ID}:us-east`,
		]);
		expect(byErrors.breakdown[0].errorRate).toBeCloseTo(0.8, 6);
	});

	test("reports average duration and TTFT per organization", async () => {
		const body = await fetchLoad(cookie, {
			window: "1d",
			groupBy: "organization",
		});

		const orgA = body.breakdown.find((row) => row.key === ORG_A);
		expect(orgA?.avgDurationMs).toBeCloseTo(1500, 6);
		// TTFT divides by its own sample count, not by requestCount — only half
		// the requests streamed.
		expect(orgA?.avgTimeToFirstTokenMs).toBeCloseTo(400, 6);

		// Org B's bucket carries no latency samples, which is what a bucket
		// aggregated before these columns existed looks like. Dividing its zero
		// sum by requestCount would report a confident 0 ms.
		const orgB = body.breakdown.find((row) => row.key === ORG_B);
		expect(orgB?.avgDurationMs).toBeNull();
		expect(orgB?.avgTimeToFirstTokenMs).toBeNull();

		// The summary is count-weighted across both orgs, so it is org A's
		// samples alone rather than the mean of 1500 and nothing.
		expect(body.summary.avgDurationMs).toBeCloseTo(1500, 6);
	});

	test("withholds latency when a mode narrows the tenant rollup", async () => {
		const body = await fetchLoad(cookie, {
			window: "1d",
			groupBy: "organization",
			mode: "credits",
		});

		// One blended duration sum against a credits-only request count would be
		// an average of the wrong population.
		expect(body.summary.avgDurationMs).toBeNull();
		expect(body.summary.avgTimeToFirstTokenMs).toBeNull();
		expect(body.breakdown.every((row) => row.avgDurationMs === null)).toBe(
			true,
		);
	});

	test("reports average duration on the mapping-history axis", async () => {
		const body = await fetchLoad(cookie, { window: "1h", groupBy: "model" });

		// 120 requests x 800ms in the closed minute, and no duration recorded in
		// the other two minutes, over 210 requests total.
		expect(body.summary.avgDurationMs).toBeCloseTo((120 * 800) / 210, 6);
		expect(body.summary.avgTimeToFirstTokenMs).toBeCloseTo(250, 6);

		const closed = body.data.find(
			(point) =>
				point.timestamp === closedMinute.toISOString().replace(".000", ""),
		);
		expect(closed?.avgDurationMs).toBeCloseTo(800, 6);
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
