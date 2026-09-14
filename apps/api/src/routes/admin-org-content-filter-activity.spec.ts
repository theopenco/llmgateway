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

describe("admin organization content filter activity", () => {
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
				projectId: "proj-a2",
				category: "all",
				sampledCount: 5,
				violationCount: 0,
				blockedCount: 0,
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
				hourTimestamp: hoursAgo(3),
				organizationId: "cf-org-a",
				projectId: "proj-a",
				category: "all",
				sampledCount: 20,
				violationCount: 1,
				blockedCount: 0,
			},
			{
				hourTimestamp: hoursAgo(3),
				organizationId: "cf-org-a",
				projectId: "proj-a",
				category: "hate",
				sampledCount: 0,
				violationCount: 1,
				blockedCount: 0,
			},
			// Another org: never mixed in.
			{
				hourTimestamp: hoursAgo(1),
				organizationId: "cf-org-b",
				projectId: "proj-b",
				category: "all",
				sampledCount: 100,
				violationCount: 50,
				blockedCount: 50,
			},
			// Outside a 4h window.
			{
				hourTimestamp: hoursAgo(30),
				organizationId: "cf-org-a",
				projectId: "proj-a",
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

	test("returns a zero-filled hourly series with totals and categories", async () => {
		const res = await app.request(
			"/admin/organizations/cf-org-a/content-filter?window=4h",
			{ headers: { Cookie: cookie } },
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.window).toBe("4h");
		expect(body.bucket).toBe("hour");
		expect(body.totals).toEqual({
			sampledCount: 35,
			violationCount: 5,
			blockedCount: 1,
			violationRate: 5 / 35,
		});
		expect(body.topCategories).toEqual([
			{ category: "violence", violationCount: 3 },
			{ category: "hate", violationCount: 1 },
		]);
		// Five bucket boundaries fall inside a 4h window; quiet ones are zero.
		expect(body.data).toHaveLength(5);
		const byTimestamp = new Map<string, Record<string, number>>(
			body.data.map((point: { timestamp: string }) => [point.timestamp, point]),
		);
		expect(byTimestamp.get(hoursAgo(1).toISOString())).toMatchObject({
			sampledCount: 15,
			violationCount: 4,
			blockedCount: 1,
		});
		expect(byTimestamp.get(hoursAgo(3).toISOString())).toMatchObject({
			sampledCount: 20,
			violationCount: 1,
			blockedCount: 0,
		});
		expect(byTimestamp.get(hoursAgo(2).toISOString())).toMatchObject({
			sampledCount: 0,
			violationCount: 0,
			blockedCount: 0,
		});
	});

	test("rolls longer windows up to days", async () => {
		const res = await app.request(
			"/admin/organizations/cf-org-a/content-filter?window=7d",
			{ headers: { Cookie: cookie } },
		);
		const body = await res.json();
		expect(body.bucket).toBe("day");
		expect(body.totals.sampledCount).toBe(135);
		expect(body.data).toHaveLength(8);
		expect(
			body.data.every((point: { timestamp: string }) =>
				point.timestamp.endsWith("T00:00:00.000Z"),
			),
		).toBe(true);
	});

	test("404s for an unknown organization", async () => {
		const res = await app.request(
			"/admin/organizations/nope/content-filter?window=7d",
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(404);
	});

	test("requires authentication", async () => {
		const res = await app.request(
			"/admin/organizations/cf-org-a/content-filter",
		);
		expect(res.status).toBe(401);
	});
});
