import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;

function utcDay(daysAgo: number): Date {
	const now = new Date();
	const start = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate(),
	);
	const offsetMs = daysAgo * 86_400_000;
	return new Date(start - offsetMs);
}

describe("admin limit hits", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values([
			{
				id: "hits-org-a",
				name: "Hits Org A",
				billingEmail: "a@limit-hits.test",
			},
			{
				id: "hits-org-b",
				name: "Hits Org B",
				billingEmail: "b@limit-hits.test",
			},
		]);
		await db.insert(tables.orgLimitHitDaily).values([
			{
				organizationId: "hits-org-a",
				day: utcDay(0),
				limitType: "rpm",
				endpointKey: "chat_completions",
				hitCount: 120,
			},
			{
				organizationId: "hits-org-a",
				day: utcDay(1),
				limitType: "topup_velocity",
				hitCount: 3,
				blockedUsd: "450",
			},
			{
				organizationId: "hits-org-b",
				day: utcDay(0),
				limitType: "spend_cap_daily",
				hitCount: 10,
			},
			// Outside the default 7-day window.
			{
				organizationId: "hits-org-b",
				day: utcDay(10),
				limitType: "rpm",
				endpointKey: "models",
				hitCount: 999,
			},
		]);
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await db.delete(tables.orgLimitHitDaily);
		await deleteAll();
	});

	it("rejects unauthenticated and non-admin requests", async () => {
		expect((await app.request("/admin/limit-hits")).status).toBe(401);

		process.env.ADMIN_EMAILS = "someone-else@example.com";
		const res = await app.request("/admin/limit-hits", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(403);
	});

	it("lists hardest-hitting organizations within the window", async () => {
		const res = await app.request("/admin/limit-hits", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.total).toBe(2);
		expect(body.organizations).toHaveLength(2);
		const [first, second] = body.organizations;
		expect(first).toMatchObject({
			organizationId: "hits-org-a",
			organizationName: "Hits Org A",
			billingEmail: "a@limit-hits.test",
			totalHits: 123,
			rpmHits: 120,
			topUpHits: 3,
			topUpBlockedUsd: 450,
			daysActive: 2,
		});
		// The 10-day-old row is outside the default 7-day window.
		expect(second).toMatchObject({
			organizationId: "hits-org-b",
			totalHits: 10,
			spendCapHits: 10,
			rpmHits: 0,
		});
	});

	it("filters by limit type and widens the window", async () => {
		const res = await app.request("/admin/limit-hits?days=30&limitType=rpm", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.total).toBe(2);
		expect(body.organizations[0]).toMatchObject({
			organizationId: "hits-org-b",
			totalHits: 999,
		});
		expect(body.organizations[1]).toMatchObject({
			organizationId: "hits-org-a",
			totalHits: 120,
		});
	});

	it("returns the per-organization daily breakdown", async () => {
		const res = await app.request(
			"/admin/organizations/hits-org-a/limit-hits",
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.hits).toHaveLength(2);
		expect(body.hits[0]).toMatchObject({
			limitType: "rpm",
			endpointKey: "chat_completions",
			hitCount: 120,
			blockedUsd: 0,
		});
		expect(body.hits[1]).toMatchObject({
			limitType: "topup_velocity",
			hitCount: 3,
			blockedUsd: 450,
		});

		const missing = await app.request(
			"/admin/organizations/no-such-org/limit-hits",
			{ headers: { Cookie: cookie } },
		);
		expect(missing.status).toBe(404);
	});
});
