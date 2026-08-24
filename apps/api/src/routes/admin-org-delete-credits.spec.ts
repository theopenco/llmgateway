import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import type * as PaymentsModule from "@/routes/payments.js";

const stripeMock = vi.hoisted(() => ({
	subscriptions: { cancel: vi.fn() },
}));

vi.mock("@/routes/payments.js", async (importOriginal) => {
	const original = await importOriginal<typeof PaymentsModule>();
	return {
		...original,
		getStripe: () => stripeMock,
	};
});

const originalAdminEmails = process.env.ADMIN_EMAILS;

async function insertOrg(id: string, credits: string) {
	await db.insert(tables.organization).values({
		id,
		name: `Credit Org ${id}`,
		billingEmail: `${id}@credits.test`,
		credits,
	});
}

async function block(orgId: string, token: string): Promise<Response> {
	return await app.request(`/admin/organizations/${orgId}/block`, {
		method: "POST",
		headers: { Cookie: token },
	});
}

async function setStatus(
	orgId: string,
	status: "active" | "deleted",
	token: string,
): Promise<Response> {
	return await app.request(`/admin/organizations/${orgId}/status`, {
		method: "PATCH",
		headers: { Cookie: token, "Content-Type": "application/json" },
		body: JSON.stringify({ status }),
	});
}

async function getStatus(orgId: string) {
	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});
	return org?.status ?? null;
}

describe("admin organization deletion credit guard", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		stripeMock.subscriptions.cancel.mockReset();
		stripeMock.subscriptions.cancel.mockResolvedValue({ status: "canceled" });
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	it("refuses to block an organization with positive credits", async () => {
		await insertOrg("credit-positive", "12.34");

		const res = await block("credit-positive", cookie);
		expect(res.status).toBe(409);
		const json = (await res.json()) as { message: string };
		expect(json.message).toContain("positive credit balance");

		expect(await getStatus("credit-positive")).toBe("active");
	});

	it("refuses to disable an organization with positive credits", async () => {
		await insertOrg("credit-positive", "0.01");

		const res = await setStatus("credit-positive", "deleted", cookie);
		expect(res.status).toBe(409);

		expect(await getStatus("credit-positive")).toBe("active");
	});

	it.each([
		["zero credits", "0"],
		["negative credits", "-5.00"],
	])("blocks an organization with %s", async (_label, credits) => {
		await insertOrg("credit-empty", credits);

		const res = await block("credit-empty", cookie);
		expect(res.status).toBe(200);

		expect(await getStatus("credit-empty")).toBe("deleted");
	});

	it.each([
		["zero credits", "0"],
		["negative credits", "-1.50"],
	])("disables an organization with %s", async (_label, credits) => {
		await insertOrg("credit-empty", credits);

		const res = await setStatus("credit-empty", "deleted", cookie);
		expect(res.status).toBe(200);

		expect(await getStatus("credit-empty")).toBe("deleted");
	});

	it("still re-enables an organization that has credits", async () => {
		await insertOrg("credit-restore", "0");
		expect((await setStatus("credit-restore", "deleted", cookie)).status).toBe(
			200,
		);

		// A gifted refund after the block must not trap the organization in the
		// deleted state: only the destructive direction is credit-gated.
		await db
			.update(tables.organization)
			.set({ credits: "25.00" })
			.where(eq(tables.organization.id, "credit-restore"));

		const res = await setStatus("credit-restore", "active", cookie);
		expect(res.status).toBe(200);

		expect(await getStatus("credit-restore")).toBe("active");
	});

	it("does not deactivate members when the block is refused", async () => {
		await insertOrg("credit-positive", "10.00");
		await db.insert(tables.user).values({
			id: "credit-member",
			name: "Credit Member",
			email: "member@credits.test",
			emailVerified: true,
		});
		await db.insert(tables.userOrganization).values({
			userId: "credit-member",
			organizationId: "credit-positive",
			role: "owner",
		});

		expect((await block("credit-positive", cookie)).status).toBe(409);

		const member = await db.query.user.findFirst({
			where: { id: { eq: "credit-member" } },
		});
		expect(member?.status).toBe("active");
	});

	it("disables an organization without deactivating its members", async () => {
		await insertOrg("disable-member-org", "0");
		await db.insert(tables.user).values({
			id: "disable-member",
			name: "Disable Member",
			email: "disable-member@credits.test",
			emailVerified: true,
		});
		await db.insert(tables.userOrganization).values({
			userId: "disable-member",
			organizationId: "disable-member-org",
			role: "owner",
		});

		expect(
			(await setStatus("disable-member-org", "deleted", cookie)).status,
		).toBe(200);

		const member = await db.query.user.findFirst({
			where: { id: { eq: "disable-member" } },
		});
		expect(member?.status).toBe("active");
	});

	it("escalates a disabled organization to a member block", async () => {
		await insertOrg("disabled-block-org", "0");
		await db.insert(tables.user).values({
			id: "disabled-block-member",
			name: "Disabled Block Member",
			email: "disabled-block-member@credits.test",
			emailVerified: true,
		});
		await db.insert(tables.userOrganization).values({
			userId: "disabled-block-member",
			organizationId: "disabled-block-org",
			role: "owner",
		});

		expect(
			(await setStatus("disabled-block-org", "deleted", cookie)).status,
		).toBe(200);
		expect((await block("disabled-block-org", cookie)).status).toBe(200);

		const member = await db.query.user.findFirst({
			where: { id: { eq: "disabled-block-member" } },
		});
		expect(member?.status).toBe("deactivated");
		expect(await getStatus("disabled-block-org")).toBe("deleted");
	});

	it("blocks members even when they belong to another active organization", async () => {
		await insertOrg("block-member-org", "0");
		await insertOrg("other-active-org", "0");
		await db.insert(tables.user).values({
			id: "block-member",
			name: "Block Member",
			email: "block-member@credits.test",
			emailVerified: true,
		});
		await db.insert(tables.userOrganization).values([
			{
				userId: "block-member",
				organizationId: "block-member-org",
				role: "owner",
			},
			{
				userId: "block-member",
				organizationId: "other-active-org",
				role: "owner",
			},
		]);

		expect((await block("block-member-org", cookie)).status).toBe(200);

		const member = await db.query.user.findFirst({
			where: { id: { eq: "block-member" } },
		});
		expect(member?.status).toBe("deactivated");
		expect(await getStatus("other-active-org")).toBe("active");
	});

	it.each([
		["blocks", (orgId: string, token: string) => block(orgId, token)],
		[
			"disables",
			(orgId: string, token: string) => setStatus(orgId, "deleted", token),
		],
	])(
		"%s an organization and cancels every subscription",
		async (_label, act) => {
			await db.insert(tables.organization).values({
				id: "subscription-org",
				name: "Subscription Org",
				billingEmail: "subscription-org@credits.test",
				plan: "pro",
				stripeSubscriptionId: "sub_pro",
				devPlan: "max",
				devPlanStripeSubscriptionId: "sub_devpass",
				chatPlan: "plus",
				chatPlanStripeSubscriptionId: "sub_chat",
			});

			expect((await act("subscription-org", cookie)).status).toBe(200);
			expect(
				stripeMock.subscriptions.cancel.mock.calls.map((call) => call[0]),
			).toEqual(["sub_pro", "sub_devpass", "sub_chat"]);

			const org = await db.query.organization.findFirst({
				where: { id: { eq: "subscription-org" } },
			});
			expect(org).toMatchObject({
				status: "deleted",
				plan: "free",
				stripeSubscriptionId: null,
				devPlan: "none",
				devPlanStripeSubscriptionId: null,
				chatPlan: "none",
				chatPlanStripeSubscriptionId: null,
			});
		},
	);

	it("re-enabling an organization does not reactivate a blocked member", async () => {
		await insertOrg("blocked-member-org", "0");
		await db.insert(tables.user).values({
			id: "blocked-member",
			name: "Blocked Member",
			email: "blocked-member@credits.test",
			emailVerified: true,
		});
		await db.insert(tables.userOrganization).values({
			userId: "blocked-member",
			organizationId: "blocked-member-org",
			role: "owner",
		});

		expect((await block("blocked-member-org", cookie)).status).toBe(200);
		expect(
			(await setStatus("blocked-member-org", "active", cookie)).status,
		).toBe(200);

		const member = await db.query.user.findFirst({
			where: { id: { eq: "blocked-member" } },
		});
		expect(member?.status).toBe("deactivated");
		expect(await getStatus("blocked-member-org")).toBe("active");
	});
});
