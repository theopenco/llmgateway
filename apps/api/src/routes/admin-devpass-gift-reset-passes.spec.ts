import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "admin-gift-reset-pass-org";
const originalMultiplier = process.env.DEV_PLAN_CREDITS_MULTIPLIER;
const originalAdminEmails = process.env.ADMIN_EMAILS;

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

interface GiftResponse {
	message: string;
	resetPasses: { lite: number; pro: number; max: number };
}

interface DetailResponse {
	resetPasses: {
		lite: number;
		pro: number;
		max: number;
		includedRemaining: number;
	};
	transactions: { type: string; amount: string | null }[];
}

interface ListResponse {
	kpis: { resetPassesSold: number; resetPassRevenue: number };
}

async function insertOrg(
	overrides: Partial<typeof tables.organization.$inferInsert> = {},
) {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Personal Org",
		billingEmail: "admin@example.com",
		kind: "devpass",
		devPlan: "pro",
		devPlanCreditsUsed: "20",
		devPlanCreditsLimit: "237",
		...overrides,
	});
	await db.insert(tables.userOrganization).values({
		userId: "test-user-id",
		organizationId: ORG_ID,
		role: "owner",
	});
}

async function getOrg() {
	const org = await db.query.organization.findFirst({
		where: { id: { eq: ORG_ID } },
	});
	if (!org) {
		throw new Error("test org disappeared");
	}
	return org;
}

async function giftRequest(
	body: unknown,
	token?: string,
	orgId: string = ORG_ID,
): Promise<Response> {
	return await app.request(`/admin/devpass/${orgId}/gift-reset-passes`, {
		method: "POST",
		headers: {
			...(token ? { Cookie: token } : {}),
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

describe("admin devpass gift reset passes", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		process.env.DEV_PLAN_CREDITS_MULTIPLIER = "3";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		if (originalMultiplier === undefined) {
			delete process.env.DEV_PLAN_CREDITS_MULTIPLIER;
		} else {
			process.env.DEV_PLAN_CREDITS_MULTIPLIER = originalMultiplier;
		}
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await db.delete(tables.transaction);
		await deleteAll();
	});

	it("rejects unauthenticated requests", async () => {
		await insertOrg();
		const res = await giftRequest({ tier: "pro", count: 1 });
		expect(res.status).toBe(401);
	});

	it("rejects non-admin users", async () => {
		await insertOrg();
		process.env.ADMIN_EMAILS = "someone-else@example.com";
		const res = await giftRequest({ tier: "pro", count: 1 }, cookie);
		expect(res.status).toBe(403);
	});

	it("404s for an unknown organization", async () => {
		const res = await giftRequest(
			{ tier: "pro", count: 1 },
			cookie,
			"no-such-org",
		);
		expect(res.status).toBe(404);
	});

	it("404s for a non-devpass organization", async () => {
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Team Org",
			billingEmail: "admin@example.com",
			kind: "default",
		});
		const res = await giftRequest({ tier: "pro", count: 1 }, cookie);
		expect(res.status).toBe(404);
	});

	it("rejects invalid counts and tiers", async () => {
		await insertOrg();
		for (const body of [
			{ tier: "pro", count: 0 },
			{ tier: "pro", count: 11 },
			{ tier: "pro", count: 1.5 },
			{ tier: "none", count: 1 },
		]) {
			const res = await giftRequest(body, cookie);
			expect(res.status).toBe(400);
		}
		expect((await getOrg()).devPlanResetPassesPro).toBe(0);
	});

	it("gifts passes and records a $0 bookkeeping transaction + audit event", async () => {
		await insertOrg();

		const res = await giftRequest(
			{ tier: "pro", count: 2, comment: "outage comp" },
			cookie,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as GiftResponse;
		expect(body.resetPasses).toEqual({ lite: 0, pro: 2, max: 0 });

		const org = await getOrg();
		expect(org.devPlanResetPassesPro).toBe(2);
		expect(org.devPlanResetPassesLite).toBe(0);
		expect(org.devPlanResetPassesMax).toBe(0);

		const txn = await db.query.transaction.findFirst({
			where: {
				organizationId: { eq: ORG_ID },
				type: { eq: "dev_plan_reset_pass_gift" },
			},
		});
		expect(txn).toBeDefined();
		expect(txn!.amount).toBeNull();
		expect(txn!.creditAmount).toBeNull();
		expect(txn!.status).toBe("completed");
		expect(txn!.description).toBe(
			"2× pro Reset Passes gifted by Administrator: outage comp",
		);

		const audit = await db.query.auditLog.findFirst({
			where: {
				organizationId: { eq: ORG_ID },
				action: { eq: "dev_plan.reset_pass_gift" },
			},
		});
		expect(audit).toBeDefined();
		expect(audit!.metadata).toMatchObject({
			tier: "pro",
			count: 2,
			comment: "outage comp",
			transactionId: txn!.id,
		});
	});

	it("accumulates gifts and supports tiers other than the current plan", async () => {
		await insertOrg({ devPlanResetPassesLite: 1 });

		const first = await giftRequest({ tier: "lite", count: 1 }, cookie);
		expect(first.status).toBe(200);
		const second = await giftRequest({ tier: "max", count: 3 }, cookie);
		expect(second.status).toBe(200);
		const body = (await second.json()) as GiftResponse;
		expect(body.resetPasses).toEqual({ lite: 2, pro: 0, max: 3 });

		const org = await getOrg();
		expect(org.devPlanResetPassesLite).toBe(2);
		expect(org.devPlanResetPassesMax).toBe(3);
	});

	it("exposes pass inventory and the gift row on the detail endpoint", async () => {
		await insertOrg();
		await giftRequest({ tier: "pro", count: 1 }, cookie);

		const res = await app.request(`/admin/devpass/${ORG_ID}`, {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as DetailResponse;
		// Pro includes 1 reset pass per cycle, none used yet.
		expect(body.resetPasses).toEqual({
			lite: 0,
			pro: 1,
			max: 0,
			includedRemaining: 1,
		});
		const giftRow = body.transactions.find(
			(t) => t.type === "dev_plan_reset_pass_gift",
		);
		expect(giftRow).toBeDefined();
		expect(giftRow!.amount).toBeNull();
	});

	it("never counts gifted passes as reset pass revenue", async () => {
		await insertOrg({ devPlanBillingCycleStart: new Date() });
		// A real purchased pass alongside the gift — only the purchase counts.
		await db.insert(tables.transaction).values({
			organizationId: ORG_ID,
			type: "dev_plan_reset_pass",
			amount: "29",
			status: "completed",
		});
		await giftRequest({ tier: "pro", count: 5 }, cookie);

		const res = await app.request("/admin/devpass", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as ListResponse;
		expect(body.kpis.resetPassesSold).toBe(1);
		expect(body.kpis.resetPassRevenue).toBe(29);
	});

	it("gifted passes are redeemable through the normal redeem flow", async () => {
		// Included pro pass already consumed this cycle, so the redeem must draw
		// from the gifted (purchased-inventory) counter.
		await insertOrg({
			devPlanIncludedResetPassesUsed: 1,
			devPlanPremiumCreditsUsed: "5",
			devPlanPremiumWeekStart: new Date(Date.now() - TWO_DAYS_MS),
		});

		const gift = await giftRequest({ tier: "pro", count: 1 }, cookie);
		expect(gift.status).toBe(200);

		// The admin test user is also the org owner, so the same session can
		// exercise the subscriber-facing redeem route.
		const redeem = await app.request("/dev-plans/reset-pass/redeem", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(redeem.status).toBe(200);

		const org = await getOrg();
		expect(org.devPlanResetPassesPro).toBe(0);
		expect(Number(org.devPlanPremiumCreditsUsed)).toBe(0);
	});
});
