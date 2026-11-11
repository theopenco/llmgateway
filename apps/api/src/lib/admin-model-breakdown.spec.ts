import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { getOrganizationTimeseries } from "@/lib/organization-timeseries.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
describe("admin model breakdowns", () => {
	let cookie: string;
	beforeEach(async () => {
		cookie = await createTestUser();
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");
		await db.insert(tables.organization).values({
			id: "breakdown-org",
			name: "Test Organization",
			billingEmail: "admin@example.com",
		});
		await db.insert(tables.project).values({
			id: "breakdown-project",
			name: "Test Project",
			organizationId: "breakdown-org",
		});
		await db.insert(tables.projectHourlyModelStats).values(
			[
				...Array.from({ length: 12 }, (_, i) => ({
					usedModel: `prefix/gpt-4o:variant-${i}`,
					usedProvider: "serving-provider",
					cost: 0.1,
					creditsCost: 0.04,
					apiKeysCost: 0.06,
					requestCount: 2,
					creditsRequestCount: 1,
					apiKeysRequestCount: 1,
					totalTokens: "10",
					inputTokens: "5",
					cachedTokens: "2",
				})),
				{
					usedModel: "other-provider/gpt-4o-mini",
					usedProvider: "other-provider",
					cost: 1,
					creditsCost: 1,
					apiKeysCost: 0,
					requestCount: 1,
					creditsRequestCount: 1,
					apiKeysRequestCount: 0,
					totalTokens: "20",
					inputTokens: "10",
					cachedTokens: "5",
				},
				{
					usedModel: "legacy/unknown-model",
					usedProvider: "legacy",
					cost: 0.2,
					creditsCost: 0.2,
					apiKeysCost: 0,
					requestCount: 1,
					creditsRequestCount: 1,
					apiKeysRequestCount: 0,
					totalTokens: "5",
					inputTokens: "5",
					cachedTokens: "0",
				},
			].map((row) => ({
				...row,
				projectId: "breakdown-project",
				hourTimestamp: hour,
			})),
		);
	});
	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteAll();
	});
	it("groups provider before ranking and uses the authoritative provider column", async () => {
		const result = await getOrganizationTimeseries({
			projectIds: ["breakdown-project"],
			startDate: hour,
			endDate: new Date(hour.getTime() + 3_599_999),
			bucket: "hour",
			groupBy: "model",
			modelView: "provider",
		});
		expect(result.series[0].key).toBe("serving-provider");
		expect(result.series).toHaveLength(3);
		const entry = result.points[0].entries.find(
			(row) => row.key === "serving-provider",
		);
		expect(entry).toMatchObject({
			requestCount: 24,
			totalTokens: 120,
			inputTokens: 60,
			cachedTokens: 24,
		});
		expect(entry?.cost).toBeCloseTo(1.2);
		const filtered = await getOrganizationTimeseries({
			projectIds: ["breakdown-project"],
			startDate: hour,
			endDate: new Date(hour.getTime() + 3_599_999),
			bucket: "hour",
			groupBy: "model",
			modelView: "provider",
			model: "serving-provider",
		});
		expect(filtered.points[0].totals.requestCount).toBe(24);
	});
	it.each(["provider", "family"] as const)(
		"accepts %s on org ranking and both time-series paths",
		async (modelView) => {
			const base = "/admin/organizations/breakdown-org";
			const query = "?window=1d&modelView=" + modelView;
			const rank = await app.request(base + "/cost-by-model" + query, {
				headers: { Cookie: cookie },
			});
			expect(rank.status).toBe(200);
			const ranking = await rank.json();
			const label = modelView === "provider" ? "serving-provider" : "OpenAI";
			expect(ranking.models[0].model).toBe(label);
			expect(ranking.models[0].cost).toBeCloseTo(
				modelView === "provider" ? 1.2 : 2.2,
			);
			for (const scope of [base, base + "/projects/breakdown-project"]) {
				for (const include of ["", "&includeTimeseries=true"]) {
					const res = await app.request(
						scope + "/cost-by-model-timeseries" + query + include,
						{ headers: { Cookie: cookie } },
					);
					expect(res.status).toBe(200);
					const data = await res.json();
					expect(data.models).toContain(label);
					if (include) {
						expect(data.timeseries.series).toHaveLength(
							modelView === "provider" ? 3 : 2,
						);
					}
				}
			}
		},
	);
});
