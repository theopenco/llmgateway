import { beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const YEAR = 2025;

function at(month: number, day: number, hour = 9) {
	return new Date(Date.UTC(YEAR, month - 1, day, hour));
}

describe("GET /orgs/{id}/wrapped", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values([
			{
				id: "test-org-id",
				name: "Test Organization",
				billingEmail: "test@example.com",
			},
			{
				id: "other-org-id",
				name: "Other Organization",
				billingEmail: "other@example.com",
			},
		]);
		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
			role: "owner",
		});
		await db.insert(tables.project).values([
			{ id: "own-project", name: "Own", organizationId: "test-org-id" },
			{ id: "other-project", name: "Other", organizationId: "other-org-id" },
		]);
		await db.insert(tables.projectHourlyStats).values([
			{
				projectId: "own-project",
				hourTimestamp: at(3, 1),
				requestCount: 10,
				cacheCount: 2,
				totalTokens: "1000",
				inputTokens: "700",
				outputTokens: "300",
				cachedTokens: "100",
			},
			{
				projectId: "own-project",
				hourTimestamp: at(3, 2, 14),
				requestCount: 30,
				totalTokens: "3000",
			},
			{
				projectId: "own-project",
				hourTimestamp: at(3, 3),
				requestCount: 5,
				totalTokens: "500",
			},
			{
				projectId: "own-project",
				hourTimestamp: at(6, 10),
				requestCount: 1,
				totalTokens: "100",
			},
			// Another year and another organization must not be counted.
			{
				projectId: "own-project",
				hourTimestamp: new Date(Date.UTC(YEAR - 1, 5, 1)),
				requestCount: 500,
				totalTokens: "50000",
			},
			{
				projectId: "other-project",
				hourTimestamp: at(3, 1),
				requestCount: 900,
				totalTokens: "90000",
			},
		]);
		await db.insert(tables.projectHourlyModelStats).values([
			{
				projectId: "own-project",
				hourTimestamp: at(3, 1),
				usedModel: "openai/model-a",
				usedProvider: "openai",
				requestCount: 20,
				totalTokens: "3000",
			},
			{
				projectId: "own-project",
				hourTimestamp: at(3, 2),
				usedModel: "azure/model-a:eastus",
				usedProvider: "azure",
				requestCount: 5,
				totalTokens: "600",
			},
			{
				projectId: "own-project",
				hourTimestamp: at(3, 2),
				usedModel: "anthropic/model-b",
				usedProvider: "anthropic",
				requestCount: 21,
				totalTokens: "1000",
			},
		]);
		await db.insert(tables.projectHourlySourceStats).values([
			{
				projectId: "own-project",
				hourTimestamp: at(3, 1),
				source: "my-app",
				requestCount: 40,
			},
			{
				projectId: "own-project",
				hourTimestamp: at(3, 1),
				source: "",
				requestCount: 6,
			},
		]);
	});

	async function wrapped(orgId = "test-org-id", query = `?year=${YEAR}`) {
		return await app.request(`/orgs/${orgId}/wrapped${query}`, {
			headers: { Cookie: token },
		});
	}

	test("summarizes the organization's year", async () => {
		const res = await wrapped();
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.organizationName).toBe("Test Organization");
		expect(body.totals).toEqual({
			requests: 46,
			totalTokens: 4600,
			inputTokens: 700,
			outputTokens: 300,
			cachedTokens: 100,
			cachedRequests: 2,
		});
		expect(body.activeDays).toBe(4);
		expect(body.longestStreakDays).toBe(3);
		expect(body.busiestDay).toEqual({ date: "2025-03-02", requests: 30 });
		expect(body.peakHourUtc).toBe(14);
		expect(body.months).toEqual([
			{ month: "2025-03", totalTokens: 4500, requests: 45 },
			{ month: "2025-06", totalTokens: 100, requests: 1 },
		]);
		// The same model served by two providers and a region is one model.
		expect(body.modelsUsed).toBe(2);
		expect(body.topModels[0]).toMatchObject({
			modelId: "model-a",
			totalTokens: 3600,
			requests: 25,
		});
		expect(body.providersUsed).toBe(3);
		expect(body.topProviders[0].providerId).toBe("openai");
		expect(body.topSources).toEqual([{ source: "my-app", requests: 40 }]);
	});

	test("returns zeros for a year without usage", async () => {
		const res = await wrapped("test-org-id", "?year=2026");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.totals.requests).toBe(0);
		expect(body.busiestDay).toBeNull();
		expect(body.topModels).toEqual([]);
	});

	test("requires a session", async () => {
		const res = await app.request(`/orgs/test-org-id/wrapped?year=${YEAR}`);
		expect(res.status).toBe(401);
	});

	test("rejects organizations the user does not belong to", async () => {
		expect((await wrapped("other-org-id")).status).toBe(403);
	});

	test("rejects project-scoped developers", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.id, "test-user-org-id"));
		expect((await wrapped()).status).toBe(403);
	});

	test("rejects future years", async () => {
		const future = new Date().getUTCFullYear() + 1;
		expect((await wrapped("test-org-id", `?year=${future}`)).status).toBe(404);
	});
});
