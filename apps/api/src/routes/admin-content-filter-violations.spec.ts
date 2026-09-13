import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;

function hoursAgo(hours: number): Date {
	const date = new Date();
	date.setUTCMinutes(0, 0, 0);
	const offsetMs = hours * 3_600_000;
	date.setTime(date.getTime() - offsetMs);
	return date;
}

describe("admin content filter violations", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db.insert(tables.organization).values([
			{ id: "cf-org-a", name: "Org A", billingEmail: "a@test.example" },
			{ id: "cf-org-b", name: "Org B", billingEmail: "b@test.example" },
		]);
		await db.insert(tables.contentFilterHourlyStats).values([
			{
				hourTimestamp: hoursAgo(1),
				organizationId: "cf-org-a",
				projectId: "proj-a",
				category: "all",
				sampledCount: 10,
				violationCount: 4,
				blockedCount: 1,
			},
			{
				hourTimestamp: hoursAgo(1),
				organizationId: "cf-org-a",
				projectId: "proj-a",
				category: "violence",
				sampledCount: 0,
				violationCount: 3,
				blockedCount: 0,
			},
			{
				hourTimestamp: hoursAgo(1),
				organizationId: "cf-org-a",
				projectId: "proj-a",
				category: "hate",
				sampledCount: 0,
				violationCount: 1,
				blockedCount: 0,
			},
			{
				hourTimestamp: hoursAgo(2),
				organizationId: "cf-org-b",
				projectId: "proj-b",
				category: "all",
				sampledCount: 20,
				violationCount: 1,
				blockedCount: 0,
			},
			// Outside the 24h window.
			{
				hourTimestamp: hoursAgo(30),
				organizationId: "cf-org-b",
				projectId: "proj-b",
				category: "all",
				sampledCount: 100,
				violationCount: 50,
				blockedCount: 0,
			},
		]);
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	test("ranks organizations by violations within the window", async () => {
		const res = await app.request(
			"/admin/content-filter/violations?window=24h",
			{ headers: { Cookie: cookie } },
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			window: "24h",
			totals: { sampledCount: 30, violationCount: 5, blockedCount: 1 },
			organizations: [
				{
					organizationId: "cf-org-a",
					organizationName: "Org A",
					plan: "free",
					sampledCount: 10,
					violationCount: 4,
					blockedCount: 1,
					violationRate: 0.4,
					topCategories: [
						{ category: "violence", violationCount: 3 },
						{ category: "hate", violationCount: 1 },
					],
				},
				{
					organizationId: "cf-org-b",
					organizationName: "Org B",
					plan: "free",
					sampledCount: 20,
					violationCount: 1,
					blockedCount: 0,
					violationRate: 0.05,
					topCategories: [],
				},
			],
		});
	});

	test("widens with the window", async () => {
		const res = await app.request(
			"/admin/content-filter/violations?window=7d",
			{ headers: { Cookie: cookie } },
		);
		const body = await res.json();
		expect(body.totals.violationCount).toBe(55);
		expect(body.organizations[0].organizationId).toBe("cf-org-b");
	});

	test("requires authentication", async () => {
		const res = await app.request("/admin/content-filter/violations");
		expect(res.status).toBe(401);
	});
});
