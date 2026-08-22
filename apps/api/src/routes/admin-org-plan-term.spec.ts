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
			projectLimit: null,
			planStartedAt: null,
			planExpiresAt: null,
			isTrialActive: false,
			trialStartDate: null,
			trialEndDate: null,
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

	it("rejects a start date with no expiry date", async () => {
		const res = await manage(cookie, {
			planStartedAt: "2026-01-15",
			planExpiresAt: null,
		});

		expect(res.status).toBe(400);

		const org = await readOrg();
		expect(org?.planStartedAt).toBeNull();
	});

	it("keeps an expiry date that was never booked as a term", async () => {
		// Stripe writes `planExpiresAt` on its own as a legacy Pro renewal date,
		// so an organization carrying one must still be manageable without having
		// to clear it first. It books no term: `getOrganizationTerm` needs both.
		const res = await manage(cookie, {
			planStartedAt: null,
			planExpiresAt: "2027-01-15",
		});

		expect(res.status).toBe(200);

		const org = await readOrg();
		expect(org?.planStartedAt).toBeNull();
		expect(org?.planExpiresAt?.toISOString()).toBe("2027-01-15T00:00:00.000Z");
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

	it("stores a trial window and marks the trial active", async () => {
		const res = await manage(cookie, {
			isTrialActive: true,
			trialStartDate: "2026-08-01",
			trialEndDate: "2026-08-31",
		});

		expect(res.status).toBe(200);

		const org = await readOrg();
		expect(org?.isTrialActive).toBe(true);
		expect(org?.trialStartDate?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
		expect(org?.trialEndDate?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
	});

	it("rejects an active trial with no end date", async () => {
		const res = await manage(cookie, {
			isTrialActive: true,
			trialStartDate: "2026-08-01",
			trialEndDate: null,
		});

		expect(res.status).toBe(400);
	});

	it("rejects a trial start that is not before the trial end", async () => {
		const res = await manage(cookie, {
			isTrialActive: true,
			trialStartDate: "2026-08-31",
			trialEndDate: "2026-08-01",
		});

		expect(res.status).toBe(400);
	});

	it("stores a trial of any length, not just the default 30 days", async () => {
		const res = await manage(cookie, {
			isTrialActive: true,
			trialStartDate: "2026-08-01",
			trialEndDate: "2026-10-30",
		});

		expect(res.status).toBe(200);

		const org = await readOrg();
		expect(org?.trialEndDate?.toISOString()).toBe("2026-10-30T00:00:00.000Z");
	});

	it("extends a trial by moving the end date out", async () => {
		await manage(cookie, {
			isTrialActive: true,
			trialStartDate: "2026-08-01",
			trialEndDate: "2026-08-31",
		});

		const res = await manage(cookie, {
			isTrialActive: true,
			trialStartDate: "2026-08-01",
			trialEndDate: "2026-09-30",
		});

		expect(res.status).toBe(200);

		const org = await readOrg();
		expect(org?.isTrialActive).toBe(true);
		expect(org?.trialStartDate?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
		expect(org?.trialEndDate?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
	});

	it("revives an ended trial when it is extended", async () => {
		await manage(cookie, {
			isTrialActive: false,
			trialStartDate: "2026-06-01",
			trialEndDate: "2026-07-01",
		});

		const res = await manage(cookie, {
			isTrialActive: true,
			trialStartDate: "2026-06-01",
			trialEndDate: "2026-09-15",
		});

		expect(res.status).toBe(200);

		const org = await readOrg();
		expect(org?.isTrialActive).toBe(true);
		expect(org?.trialEndDate?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
	});

	it("keeps the trial dates on record when the trial is ended", async () => {
		await manage(cookie, {
			isTrialActive: true,
			trialStartDate: "2026-08-01",
			trialEndDate: "2026-08-31",
		});

		await manage(cookie, {
			isTrialActive: false,
			trialStartDate: "2026-08-01",
			trialEndDate: "2026-08-31",
		});

		const org = await readOrg();
		expect(org?.isTrialActive).toBe(false);
		expect(org?.trialEndDate?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
	});
});
