import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";

const MODEL = "openai/global-stats-model";
// Separate model id so the bulk precision fixture cannot collide with the
// per-bucket rows above on (day, model, provider, mode, kind).
const BULK_MODEL = "openai/global-stats-bulk-model";
const SOURCE = "global-stats-source";
const PROVIDER_KEY_ID = "global-stats-provider-key";

const DAY = new Date();
DAY.setUTCHours(0, 0, 0, 0);
const DATE = DAY.toISOString().split("T")[0];

interface Bucket {
	usedMode: "credits" | "api-keys" | "unknown";
	orgKind: "default" | "devpass" | "chat" | "unknown";
	requestCount: number;
	clientErrorCount?: number;
	cost: number;
	tokens: number;
}

// One row per (mode, kind) tuple — the shape the aggregator now writes. The
// "unknown/unknown" bucket stands in for rows aggregated before the dimensions
// existed.
const BUCKETS: Bucket[] = [
	{
		usedMode: "credits",
		orgKind: "default",
		requestCount: 10,
		clientErrorCount: 1,
		cost: 1,
		tokens: 100,
	},
	{
		usedMode: "api-keys",
		orgKind: "default",
		requestCount: 5,
		cost: 0.5,
		tokens: 50,
	},
	{
		usedMode: "credits",
		orgKind: "devpass",
		requestCount: 2,
		cost: 0.25,
		tokens: 20,
	},
	{
		usedMode: "unknown",
		orgKind: "unknown",
		requestCount: 1,
		cost: 0.1,
		tokens: 10,
	},
];

// The per-bucket fixture above also lands in the window every query covers.
const BASE_FIXTURE_COST = BUCKETS.reduce(
	(sum, bucket) => sum + Math.fround(bucket.cost),
	0,
);

interface GlobalStatsResponse {
	totals: {
		requestCount: number;
		cost: number;
		totalTokens: number;
		inputTokens: number;
		errorCount: number;
	};
	composition: {
		byMode: {
			key: string;
			label: string;
			requestCount: number;
			cost: number;
		}[];
		byKind: {
			key: string;
			label: string;
			requestCount: number;
			cost: number;
		}[];
	};
	breakdown: { key: string; label: string; requestCount: number }[];
	timeseries: { date: string; requestCount: number; cost: number }[];
	groupBy: string;
	providerKeyId: string | null;
}

async function fetchStats(
	cookie: string,
	query: Record<string, string> = {},
): Promise<GlobalStatsResponse> {
	const params = new URLSearchParams({ from: DATE, to: DATE, ...query });
	const res = await app.request(`/admin/global-stats?${params.toString()}`, {
		headers: { Cookie: cookie },
	});
	expect(res.status).toBe(200);
	return (await res.json()) as GlobalStatsResponse;
}

// `deleteAll()` does not cover the global stats tables, so this suite owns its
// own cleanup — scoped to its MODEL/SOURCE so it can never take out rows another
// suite inserted. Also runs before inserting, so a crashed run's leftovers do
// not collide with the unique key.
const clearFixtures = async () => {
	await db
		.delete(tables.globalModelStats)
		.where(eq(tables.globalModelStats.usedModel, MODEL));
	await db
		.delete(tables.globalModelStats)
		.where(eq(tables.globalModelStats.usedModel, BULK_MODEL));
	await db
		.delete(tables.globalSourceStats)
		.where(eq(tables.globalSourceStats.source, SOURCE));
	await db
		.delete(tables.globalProviderKeyModelStats)
		.where(
			eq(tables.globalProviderKeyModelStats.providerKeyId, PROVIDER_KEY_ID),
		);
};

describe("admin — global stats mode/kind dimensions", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await clearFixtures();

		await db.insert(tables.globalModelStats).values(
			BUCKETS.map((bucket) => ({
				dayTimestamp: DAY,
				usedModel: MODEL,
				usedProvider: "openai",
				usedMode: bucket.usedMode,
				orgKind: bucket.orgKind,
				requestCount: bucket.requestCount,
				errorCount: 1,
				clientErrorCount: bucket.clientErrorCount ?? 0,
				cost: bucket.cost,
				totalTokens: String(bucket.tokens),
				inputTokens: String(bucket.tokens / 2),
				outputTokens: String(bucket.tokens / 2),
			})),
		);
		await db.insert(tables.globalSourceStats).values(
			BUCKETS.map((bucket) => ({
				dayTimestamp: DAY,
				source: SOURCE,
				usedMode: bucket.usedMode,
				orgKind: bucket.orgKind,
				requestCount: bucket.requestCount,
				errorCount: 1,
				clientErrorCount: bucket.clientErrorCount ?? 0,
				cost: bucket.cost,
				totalTokens: String(bucket.tokens),
				inputTokens: String(bucket.tokens / 2),
				outputTokens: String(bucket.tokens / 2),
			})),
		);
	});

	afterEach(async () => {
		await clearFixtures();
		await deleteAll();
	});

	describe("provider key filter", () => {
		beforeEach(async () => {
			// Only the credits/default bucket was served by the credential.
			await db.insert(tables.globalProviderKeyModelStats).values({
				dayTimestamp: DAY,
				providerKeyId: PROVIDER_KEY_ID,
				usedModel: MODEL,
				usedProvider: "openai",
				usedMode: "credits",
				orgKind: "default",
				requestCount: 4,
				cost: 0.4,
				totalTokens: "40",
				inputTokens: "20",
				outputTokens: "20",
			});
		});

		test("narrows every section to the credential", async () => {
			const body = await fetchStats(cookie, { providerKeyId: PROVIDER_KEY_ID });
			expect(body.providerKeyId).toBe(PROVIDER_KEY_ID);
			expect(body.totals.requestCount).toBe(4);
			expect(body.totals.cost).toBeCloseTo(0.4, 6);
			expect(body.totals.totalTokens).toBe(40);
			expect(body.breakdown).toEqual([
				expect.objectContaining({ key: MODEL, requestCount: 4 }),
			]);
			expect(body.composition.byMode).toEqual([
				expect.objectContaining({ key: "credits", requestCount: 4 }),
			]);
		});

		test("supports the provider view and the mode/kind groupings", async () => {
			const byProvider = await fetchStats(cookie, {
				providerKeyId: PROVIDER_KEY_ID,
				modelView: "provider",
			});
			expect(byProvider.breakdown).toEqual([
				expect.objectContaining({ key: "openai", requestCount: 4 }),
			]);
			const byKind = await fetchStats(cookie, {
				providerKeyId: PROVIDER_KEY_ID,
				groupBy: "kind",
			});
			expect(byKind.breakdown).toEqual([
				expect.objectContaining({ key: "default", requestCount: 4 }),
			]);
		});

		test("falls back to the model grouping for x-source", async () => {
			const body = await fetchStats(cookie, {
				providerKeyId: PROVIDER_KEY_ID,
				groupBy: "source",
			});
			expect(body.groupBy).toBe("model");
			expect(body.breakdown[0]?.key).toBe(MODEL);
		});

		test("composes with mode and kind filters", async () => {
			const body = await fetchStats(cookie, {
				providerKeyId: PROVIDER_KEY_ID,
				mode: "api-keys",
			});
			expect(body.totals.requestCount).toBe(0);
		});

		test("lists credentials with traffic in the range", async () => {
			await db.insert(tables.providerKey).values({
				id: PROVIDER_KEY_ID,
				...encryptProviderKeyForStorage(
					"sk-global-stats",
					PROVIDER_KEY_ID,
					null,
				),
				provider: "openai",
				managed: true,
				comment: "Global stats fixture",
			});
			const res = await app.request(
				`/admin/global-stats/provider-keys?from=${DATE}&to=${DATE}`,
				{ headers: { Cookie: cookie } },
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				providerKeys: {
					id: string;
					comment: string | null;
					requestCount: number;
					cost: number;
				}[];
			};
			const key = body.providerKeys.find((k) => k.id === PROVIDER_KEY_ID);
			expect(key).toMatchObject({
				comment: "Global stats fixture",
				requestCount: 4,
			});
			expect(key?.cost).toBeCloseTo(0.4, 6);

			const filtered = await app.request(
				`/admin/global-stats/provider-keys?from=${DATE}&to=${DATE}&mode=api-keys`,
				{ headers: { Cookie: cookie } },
			);
			expect(
				((await filtered.json()) as { providerKeys: { id: string }[] })
					.providerKeys,
			).toEqual([]);
		});
	});

	test("blends every bucket when unfiltered", async () => {
		const body = await fetchStats(cookie);
		expect(body.totals.requestCount).toBe(18);
		expect(body.totals.cost).toBeCloseTo(1.85, 6);
		expect(body.totals.totalTokens).toBe(180);
	});

	test("narrows every metric to the selected mode, not just spend", async () => {
		const body = await fetchStats(cookie, { mode: "credits" });
		expect(body.totals.requestCount).toBe(12);
		expect(body.totals.cost).toBeCloseTo(1.25, 6);
		// Tokens and errors are scoped too — this is what the denormalized
		// per-mode column pairs could never do.
		expect(body.totals.totalTokens).toBe(120);
		expect(body.totals.inputTokens).toBe(60);
		expect(body.totals.errorCount).toBe(1);
	});

	test("narrows to the selected organization kind", async () => {
		const body = await fetchStats(cookie, { kind: "devpass" });
		expect(body.totals.requestCount).toBe(2);
		expect(body.totals.cost).toBeCloseTo(0.25, 6);
		expect(body.totals.totalTokens).toBe(20);
	});

	test("mode and kind filters compose", async () => {
		const body = await fetchStats(cookie, {
			mode: "credits",
			kind: "default",
		});
		expect(body.totals.requestCount).toBe(10);
		expect(body.totals.cost).toBeCloseTo(1, 6);
	});

	test("the modes partition the blended total exactly", async () => {
		const all = await fetchStats(cookie);
		const credits = await fetchStats(cookie, { mode: "credits" });
		const byok = await fetchStats(cookie, { mode: "api-keys" });
		const unknown = await fetchStats(cookie, { mode: "unknown" });
		expect(
			credits.totals.requestCount +
				byok.totals.requestCount +
				unknown.totals.requestCount,
		).toBe(all.totals.requestCount);
		expect(
			credits.totals.cost + byok.totals.cost + unknown.totals.cost,
		).toBeCloseTo(all.totals.cost, 6);
		expect(
			credits.totals.totalTokens +
				byok.totals.totalTokens +
				unknown.totals.totalTokens,
		).toBe(all.totals.totalTokens);
	});

	test("composition reconciles with the totals and honours the other filter", async () => {
		const body = await fetchStats(cookie);
		expect(
			body.composition.byMode.reduce((sum, item) => sum + item.requestCount, 0),
		).toBe(18);
		expect(
			body.composition.byKind.reduce((sum, item) => sum + item.requestCount, 0),
		).toBe(18);
		expect(
			body.composition.byKind.find((item) => item.key === "devpass")?.label,
		).toBe("DevPass");
		expect(
			body.composition.byKind.find((item) => item.key === "default")?.label,
		).toBe("PAYG");

		// byKind is scoped by the mode filter, so BYOK leaves only the PAYG org.
		const byok = await fetchStats(cookie, { mode: "api-keys" });
		expect(
			byok.composition.byKind.filter((item) => item.requestCount > 0),
		).toHaveLength(1);
		expect(
			byok.composition.byKind.find((item) => item.requestCount > 0)?.key,
		).toBe("default");
	});

	// Costs are stored in float4 columns. Summing them *as* float4 (Postgres'
	// default for SUM(real)) runs out of significant digits well before the
	// all-time totals this page shows, and the error depends on how the rows were
	// grouped — so the headline stopped matching the slices underneath it. A
	// handful of rows never showed it; the drift only appears at production
	// magnitude, hence the bulk fixture.
	test("large all-time sums stay exact and grouping-independent", async () => {
		const DAYS = 700;
		const PER_ROW_COST = 4321.1234;
		const days = Array.from(
			{ length: DAYS },
			(_, i) => new Date(DAY.getTime() - i * 24 * 60 * 60 * 1000), // eslint-disable-line no-mixed-operators
		);

		await db.insert(tables.globalModelStats).values(
			days.flatMap((day) =>
				BUCKETS.map((bucket) => ({
					dayTimestamp: day,
					usedModel: BULK_MODEL,
					usedProvider: "openai",
					usedMode: bucket.usedMode,
					orgKind: bucket.orgKind,
					requestCount: bucket.requestCount,
					cost: PER_ROW_COST,
				})),
			),
		);

		const from = days[days.length - 1].toISOString().split("T")[0];
		const body = await fetchStats(cookie, { from, to: DATE });

		// The reported symptom: the headline and the slices under it are the same
		// rows grouped two ways, so they have to agree to the cent.
		const byMode = body.composition.byMode.reduce(
			(sum, item) => sum + item.cost,
			0,
		);
		const byKind = body.composition.byKind.reduce(
			(sum, item) => sum + item.cost,
			0,
		);
		const timeseriesTotal = body.timeseries.reduce(
			(sum, point) => sum + point.cost,
			0,
		);
		expect(byMode).toBeCloseTo(body.totals.cost, 2);
		expect(byKind).toBeCloseTo(body.totals.cost, 2);
		expect(timeseriesTotal).toBeCloseTo(body.totals.cost, 2);

		// float4 rounds PER_ROW_COST on the way in, so compare against the value
		// the column actually holds rather than the literal above.
		const stored = Math.fround(PER_ROW_COST);
		expect(body.totals.cost).toBeCloseTo(
			stored * DAYS * BUCKETS.length + BASE_FIXTURE_COST, // eslint-disable-line no-mixed-operators
			2,
		);
	});

	test("groups the breakdown by billing mode and organization kind", async () => {
		const byMode = await fetchStats(cookie, { groupBy: "mode" });
		expect(
			byMode.breakdown.map((item) => `${item.key}:${item.requestCount}`).sort(),
		).toEqual(["api-keys:5", "credits:12", "unknown:1"]);
		expect(
			byMode.breakdown.find((item) => item.key === "api-keys")?.label,
		).toBe("BYOK");

		const byKind = await fetchStats(cookie, { groupBy: "kind" });
		expect(
			byKind.breakdown.map((item) => `${item.key}:${item.requestCount}`).sort(),
		).toEqual(["default:15", "devpass:2", "unknown:1"]);
	});
});
