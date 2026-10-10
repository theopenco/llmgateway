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
