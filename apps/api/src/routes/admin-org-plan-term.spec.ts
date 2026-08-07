import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;

const ORG_ID = "org-plan-term-test";

async function manage(
	cookie: string,
	body: Record<string, unknown>,
): Promise<Response> {
	return await app.request(`/admin/organizations/${ORG_ID}/manage`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json", Cookie: cookie },
		body: JSON.stringify({
			name: "Plan Term Test",
			plan: "enterprise",
			seats: null,
			apiKeyLimit: null,
			planStartedAt: null,
			planExpiresAt: null,
			...body,
		}),
	});
}

async function readOrg() {
	return await db.query.organization.findFirst({
		where: { id: { eq: ORG_ID } },
	});
}

describe("admin organization plan term", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Plan Term Test",
			billingEmail: "plan-term@test.example",
			plan: "enterprise",
		});
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	it("stores a calendar-day term at UTC midnight", async () => {
		const res = await manage(cookie, {
			planStartedAt: "2026-01-15",
			planExpiresAt: "2027-01-15",
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			planStartedAt: "2026-01-15T00:00:00.000Z",
			planExpiresAt: "2027-01-15T00:00:00.000Z",
		});

		const org = await readOrg();
		expect(org?.planStartedAt?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
		expect(org?.planExpiresAt?.toISOString()).toBe("2027-01-15T00:00:00.000Z");
	});

	it("clears the term when both dates are null", async () => {
		await manage(cookie, {
			planStartedAt: "2026-01-15",
			planExpiresAt: "2027-01-15",
		});

		const res = await manage(cookie, {
			planStartedAt: null,
			planExpiresAt: null,
		});

		expect(res.status).toBe(200);
		const org = await readOrg();
		expect(org?.planStartedAt).toBeNull();
		expect(org?.planExpiresAt).toBeNull();
	});

	it("rejects a start date that is not before the expiry", async () => {
		const res = await manage(cookie, {
			planStartedAt: "2027-01-15",
			planExpiresAt: "2027-01-15",
		});

		expect(res.status).toBe(400);

		const org = await readOrg();
		expect(org?.planExpiresAt).toBeNull();
	});

	it("rejects malformed dates", async () => {
		for (const value of ["15/01/2027", "2027-01-15T00:00:00Z", "2027-02-31"]) {
			const res = await manage(cookie, { planExpiresAt: value });
			expect(res.status).toBe(400);
		}
	});

	it("records the term change in the audit log", async () => {
		await manage(cookie, {
			planStartedAt: "2026-01-15",
			planExpiresAt: "2027-01-15",
		});

		const entry = await db.query.auditLog.findFirst({
			where: {
				organizationId: { eq: ORG_ID },
				action: { eq: "organization.manage" },
			},
		});

		expect(entry?.metadata).toMatchObject({
			previousPlanExpiresAt: null,
			newPlanExpiresAt: "2027-01-15T00:00:00.000Z",
			newPlanStartedAt: "2026-01-15T00:00:00.000Z",
		});
	});
});
