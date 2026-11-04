import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { getOrganizationTimeseries } from "@/lib/organization-timeseries.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import { promptCacheRate } from "@llmgateway/shared/prompt-cache";

const startDate = new Date("2026-10-01T00:00:00Z");
const endDate = new Date("2026-10-01T02:59:59Z");
const args = {
	projectIds: ["cache-project"],
	startDate,
	endDate,
	bucket: "hour" as const,
	groupBy: "model" as const,
};

describe("organization timeseries", () => {
	let cookie: string;
	beforeEach(async () => {
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: "cache-org",
			name: "Test Organization",
			billingEmail: "test@example.com",
		});
		await db.insert(tables.project).values([
			{
				id: "cache-project",
				name: "Test Project",
				organizationId: "cache-org",
			},
			{
				id: "other-project",
				name: "Other Project",
				organizationId: "cache-org",
			},
		]);
		await db.insert(tables.user).values({
			id: "cache-user",
			name: "Test User",
			email: "cache@example.com",
		});
		await db.insert(tables.apiKey).values({
			id: "cache-key",
			projectId: "cache-project",
			description: "Test Key",
			createdBy: "cache-user",
			...hashApiKeyForStorage("test-cache-token"),
		});
		for (const [hour, inputTokens, cachedTokens] of [
			[0, "100", "100"],
			[1, "900", "0"],
		] as const) {
			const value = {
				projectId: "cache-project",
				hourTimestamp: new Date(`2026-10-01T0${hour}:00:00Z`),
				usedModel: "provider/model:region",
				usedProvider: "provider",
				requestCount: 3,
				inputTokens,
				cachedTokens,
				totalTokens: inputTokens,
				cost: 1,
			};
			await db.insert(tables.projectHourlyModelStats).values(value);
			await db
				.insert(tables.apiKeyHourlyModelStats)
				.values({ ...value, apiKeyId: "cache-key" });
		}
		await db.insert(tables.apiKeyHourlyModelStats).values({
			projectId: "other-project",
			apiKeyId: "other-key",
			hourTimestamp: startDate,
			usedModel: "provider/other",
			usedProvider: "provider",
			inputTokens: "999999",
			requestCount: 100,
		});
	});
	afterEach(async () => {
		await deleteAll();
	});
	it("pads gaps and aggregates before applying sample thresholds", async () => {
		const hourly = await getOrganizationTimeseries(args);
		expect(hourly.points).toHaveLength(3);
		expect(hourly.series).toEqual([{ key: "model", label: "model" }]);
		expect(promptCacheRate(hourly.points[0].entries[0])).toBeNull();
		expect(hourly.points[2].entries).toEqual([]);
		const daily = await getOrganizationTimeseries({ ...args, bucket: "day" });
		expect(promptCacheRate(daily.points[0].entries[0])).toBe(10);
		expect(daily.points[0].totals.requestCount).toBe(6);
	});
	it("filters keys and models together across every grouping", async () => {
		for (const groupBy of ["model", "project", "apiKey", "user"] as const) {
			const result = await getOrganizationTimeseries({
				...args,
				groupBy,
				model: "model",
				apiKeyId: "cache-key",
			});
			expect(result.points[0].totals.inputTokens).toBe(100);
			expect(result.filters.apiKeys.map((key) => key.key)).toEqual([
				"cache-key",
			]);
		}
		await expect(
			getOrganizationTimeseries({ ...args, apiKeyId: "other-key" }),
		).rejects.toMatchObject({ status: 404 });
		expect(
			(await getOrganizationTimeseries({ ...args, model: "absent" })).series,
		).toEqual([]);
	});
	it("retains deleted-key usage and supports mapping view", async () => {
		await db.delete(tables.apiKey);
		const result = await getOrganizationTimeseries({
			...args,
			groupBy: "apiKey",
			apiKeyId: "cache-key",
		});
		expect(result.series[0].label).toContain("Deleted key");
		expect(
			(await getOrganizationTimeseries({ ...args, modelView: "mapping" }))
				.series[0].key,
		).toBe("provider/model:region");
	});
	it("honors local dates and marks only the current bucket incomplete", async () => {
		const result = await getOrganizationTimeseries({
			...args,
			bucket: "day",
			timeZone: "America/Los_Angeles",
			now: startDate,
		});
		expect(result.points[0].timestamp).toBe("2026-09-30T07:00:00.000Z");
		expect(result.points[0].incomplete).toBe(true);
	});
	it("rejects oversized hourly ranges and preserves hourly instants across DST", async () => {
		await expect(
			getOrganizationTimeseries({
				...args,
				endDate: new Date("2026-11-05T00:00:00Z"),
			}),
		).rejects.toMatchObject({ status: 400 });
		const result = await getOrganizationTimeseries({
			...args,
			projectIds: [],
			startDate: new Date("2026-11-01T08:00:00Z"),
			endDate: new Date("2026-11-01T10:00:00Z"),
			timeZone: "America/Los_Angeles",
		});
		expect(new Set(result.points.map((p) => p.timestamp)).size).toBe(3);
	});
	it("keeps daily callers compatible and enforces organization access", async () => {
		const path =
			"/analytics/activity?organizationId=cache-org&from=2026-10-01&to=2026-10-01";
		expect((await app.request(path + "&includeTimeseries=true")).status).toBe(
			401,
		);
		expect(
			(
				await app.request(path + "&includeTimeseries=true", {
					headers: { Cookie: cookie },
				})
			).status,
		).toBe(403);
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: "cache-org",
			role: "owner",
		});
		expect(
			(
				await app.request(path + "&includeTimeseries=true", {
					headers: { Cookie: cookie },
				})
			).status,
		).toBe(403);
		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, "cache-org"));
		const daily = await app.request(path, { headers: { Cookie: cookie } });
		expect(daily.status).toBe(200);
		expect((await daily.json()).activity[0].date).toBe("2026-10-01");
		const hourly = await app.request(
			path + "&includeTimeseries=true&bucket=hour",
			{ headers: { Cookie: cookie } },
		);
		expect(hourly.status).toBe(200);
		expect((await hourly.json()).timeseries.points).toHaveLength(24);
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.organizationId, "cache-org"));
		expect(
			(
				await app.request(path + "&includeTimeseries=true", {
					headers: { Cookie: cookie },
				})
			).status,
		).toBe(403);
	});
	it("requires admin access for admin timeseries", async () => {
		const path =
			"/admin/organizations/cache-org/cost-by-model-timeseries?includeTimeseries=true&window=30d&bucket=hour";
		expect((await app.request(path)).status).toBe(401);
		const original = process.env.ADMIN_FULL_ACCESS_EMAILS;
		try {
			process.env.ADMIN_FULL_ACCESS_EMAILS = "someone-else@example.com";
			expect(
				(await app.request(path, { headers: { Cookie: cookie } })).status,
			).toBe(403);
			process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
			const response = await app.request(path, { headers: { Cookie: cookie } });
			expect(response.status).toBe(200);
			expect((await response.json()).timeseries.bucket).toBe("hour");
		} finally {
			if (original === undefined) {
				delete process.env.ADMIN_FULL_ACCESS_EMAILS;
			} else {
				process.env.ADMIN_FULL_ACCESS_EMAILS = original;
			}
		}
	});

	it("serves project prompt cache rates to enterprise organizations only", async () => {
		const path =
			"/activity/prompt-cache?projectId=cache-project&from=2026-10-01&to=2026-10-01";
		const headers = { Cookie: cookie };
		expect((await app.request(path)).status).toBe(401);
		expect((await app.request(path, { headers })).status).toBe(403);
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: "cache-org",
			role: "owner",
		});
		expect((await app.request(path, { headers })).status).toBe(403);
		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, "cache-org"));
		const hourly = await app.request(path, { headers });
		expect(hourly.status).toBe(200);
		const { timeseries } = await hourly.json();
		expect(timeseries.bucket).toBe("hour");
		expect(timeseries.points).toHaveLength(24);
		expect(timeseries.series).toEqual([{ key: "model", label: "model" }]);
		const daily = await app.request(path + "&bucket=day", { headers });
		const point = (await daily.json()).timeseries.points[0];
		expect(promptCacheRate(point.entries[0])).toBe(10);
		// A second key in the same project with a very different cache rate.
		await db.insert(tables.apiKey).values({
			id: "other-cache-key",
			projectId: "cache-project",
			description: "Other Key",
			createdBy: "cache-user",
			...hashApiKeyForStorage("other-cache-token"),
		});
		await db.insert(tables.apiKeyHourlyModelStats).values({
			projectId: "cache-project",
			apiKeyId: "other-cache-key",
			hourTimestamp: startDate,
			usedModel: "provider/other-model",
			usedProvider: "provider",
			requestCount: 10,
			inputTokens: "1000",
			cachedTokens: "900",
		});
		const filtered = await app.request(
			path + "&bucket=day&apiKeyId=cache-key",
			{ headers },
		);
		expect(filtered.status).toBe(200);
		const filteredPoint = (await filtered.json()).timeseries.points[0];
		expect(filteredPoint.totals.inputTokens).toBe(1000);
		expect(promptCacheRate(filteredPoint.entries[0])).toBe(10);
		const other = await app.request(
			path + "&bucket=day&apiKeyId=other-cache-key",
			{ headers },
		);
		expect(
			promptCacheRate((await other.json()).timeseries.points[0].totals),
		).toBe(90);
		// Ranges over 30 days default to daily buckets instead of failing.
		const long = await app.request(
			"/activity/prompt-cache?projectId=cache-project&from=2026-08-01&to=2026-10-01",
			{ headers },
		);
		expect(long.status).toBe(200);
		expect((await long.json()).timeseries.bucket).toBe("day");
	});
	it("limits key-scoped developers to their own keys' prompt cache data", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, "cache-org"));
		await db.insert(tables.userOrganization).values({
			id: "cache-dev-membership",
			userId: "test-user-id",
			organizationId: "cache-org",
			role: "developer",
		});
		await db.insert(tables.userProject).values({
			id: "cache-dev-project",
			userOrganizationId: "cache-dev-membership",
			projectId: "cache-project",
		});
		await db.insert(tables.apiKey).values({
			id: "dev-own-key",
			projectId: "cache-project",
			description: "Own Key",
			createdBy: "test-user-id",
			...hashApiKeyForStorage("dev-own-token"),
		});
		await db.insert(tables.apiKeyHourlyModelStats).values({
			projectId: "cache-project",
			apiKeyId: "dev-own-key",
			hourTimestamp: startDate,
			usedModel: "provider/own-model",
			usedProvider: "provider",
			requestCount: 6,
			inputTokens: "200",
			cachedTokens: "50",
		});
		const headers = { Cookie: cookie };
		const path =
			"/activity/prompt-cache?projectId=cache-project&from=2026-10-01&to=2026-10-01&bucket=day";
		const res = await app.request(path, { headers });
		expect(res.status).toBe(200);
		const { timeseries } = await res.json();
		expect(timeseries.series).toEqual([
			{ key: "own-model", label: "own-model" },
		]);
		expect(timeseries.filters.models).toEqual([
			{ key: "own-model", label: "own-model" },
		]);
		expect(timeseries.points[0].totals.inputTokens).toBe(200);
		expect(
			(await app.request(path + "&apiKeyId=cache-key", { headers })).status,
		).toBe(403);
	});
	it("scopes admin project timeseries to the requested project", async () => {
		const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
		await db.insert(tables.projectHourlyModelStats).values(
			[
				["cache-project", "400", "100"],
				["other-project", "9000", "9000"],
			].map(([projectId, inputTokens, cachedTokens]) => ({
				projectId,
				hourTimestamp: hour,
				usedModel: "provider/recent",
				usedProvider: "provider",
				inputTokens,
				cachedTokens,
				requestCount: 5,
			})),
		);
		const base =
			"/admin/organizations/cache-org/projects/cache-project/cost-by-model-timeseries?window=1d&bucket=hour";
		expect((await app.request(base)).status).toBe(401);
		const original = process.env.ADMIN_FULL_ACCESS_EMAILS;
		try {
			process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
			const headers = { Cookie: cookie };
			const response = await app.request(base + "&includeTimeseries=true", {
				headers,
			});
			expect(response.status).toBe(200);
			const { timeseries } = await response.json();
			const totals = timeseries.points.reduce(
				(sum: number, point: { totals: { inputTokens: number } }) =>
					sum + point.totals.inputTokens,
				0,
			);
			expect(totals).toBe(400);
			const point = timeseries.points.find(
				(p: { totals: { inputTokens: number } }) => p.totals.inputTokens > 0,
			);
			expect(promptCacheRate(point.entries[0])).toBe(25);
			const source = await app.request(
				base + "&includeTimeseries=true&groupBy=source",
				{ headers },
			);
			expect(source.status).toBe(200);
			expect((await source.json()).timeseries).toBeUndefined();
			expect(
				(
					await app.request(
						"/admin/organizations/other-org/projects/cache-project/cost-by-model-timeseries?includeTimeseries=true",
						{ headers },
					)
				).status,
			).toBe(404);
		} finally {
			if (original === undefined) {
				delete process.env.ADMIN_FULL_ACCESS_EMAILS;
			} else {
				process.env.ADMIN_FULL_ACCESS_EMAILS = original;
			}
		}
	});
	it("ranks cache series by whole-window input and keeps volume for omitted series", async () => {
		await db.insert(tables.projectHourlyModelStats).values(
			Array.from({ length: 12 }, (_, index) => ({
				projectId: "cache-project",
				hourTimestamp: startDate,
				usedModel: `provider/ranked-${index}`,
				usedProvider: "provider",
				inputTokens: String(2000 + index),
				cachedTokens: "1000",
				requestCount: 5,
			})),
		);
		const result = await getOrganizationTimeseries({
			...args,
			rankBy: "inputTokens",
		});
		expect(result.series).toHaveLength(10);
		expect(result.series[0].key).toBe("ranked-11");
		expect(result.points[0].totals.requestCount).toBe(63);
		expect(result.points[0].entries).toHaveLength(10);
	});
	it("retains platform volume in key and user breakdowns", async () => {
		await db.insert(tables.projectHourlyModelStats).values({
			projectId: "cache-project",
			hourTimestamp: startDate,
			usedModel: "provider/platform",
			usedProvider: "provider",
			inputTokens: "200",
			cachedTokens: "50",
			requestCount: 5,
		});
		for (const groupBy of ["apiKey", "user"] as const) {
			const result = await getOrganizationTimeseries({ ...args, groupBy });
			expect(result.points[0].totals.requestCount).toBe(8);
			expect(
				result.points[0].entries.find(
					(entry) => entry.key === "__unattributed__",
				)?.cachedTokens,
			).toBe(50);
		}
	});

	it("uses identical source hours for hourly and daily partial windows", async () => {
		const partial = { ...args, startDate: new Date("2026-10-01T00:30:00Z") };
		const hourly = await getOrganizationTimeseries(partial);
		const daily = await getOrganizationTimeseries({
			...partial,
			bucket: "day",
		});
		expect(hourly.points[0].timestamp).toBe("2026-10-01T01:00:00Z");
		expect(
			hourly.points.reduce((sum, point) => sum + point.totals.requestCount, 0),
		).toBe(3);
		expect(daily.points[0].totals.requestCount).toBe(3);
	});
	it("ranks spend by billing mode but always ranks cache by all input", async () => {
		await db.update(tables.projectHourlyModelStats).set({ creditsCost: 1 });
		await db.insert(tables.projectHourlyModelStats).values({
			projectId: "cache-project",
			hourTimestamp: startDate,
			usedModel: "provider/byok",
			usedProvider: "provider",
			inputTokens: "20000",
			requestCount: 5,
			cost: 100,
			apiKeysCost: 100,
		});
		expect(
			(await getOrganizationTimeseries({ ...args, mode: "credits" })).series[0]
				.key,
		).toBe("model");
		expect(
			(await getOrganizationTimeseries({ ...args, mode: "api-keys" })).series[0]
				.key,
		).toBe("byok");
		expect(
			(
				await getOrganizationTimeseries({
					...args,
					mode: "credits",
					rankBy: "inputTokens",
				})
			).series[0].key,
		).toBe("byok");
	});
});
