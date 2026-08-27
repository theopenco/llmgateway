import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

import {
	anonymizeBillingRecordsForEmail,
	cancelOrganizationSubscriptions,
	DELETED_ORGANIZATION_BILLING_EMAIL,
	DELETED_ORGANIZATION_NAME,
	findSoleMemberOrganizations,
	getOrganizationSubscriptionIds,
	tearDownSoleMemberOrganizations,
} from "./account-deletion.js";

import type * as PaymentsModule from "@/routes/payments.js";

const stripeMock = vi.hoisted(() => ({
	subscriptions: { cancel: vi.fn() },
	customers: { del: vi.fn() },
}));

vi.mock("@/routes/payments.js", async (importOriginal) => {
	const original = await importOriginal<typeof PaymentsModule>();
	return {
		...original,
		getStripe: () => stripeMock,
	};
});

const USER_ID = "test-user-id";
const ORG_ID = "test-org-id";

async function seedOrg(overrides: Record<string, unknown> = {}) {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "DevPass",
		billingEmail: "admin@example.com",
		kind: "devpass",
		...overrides,
	});
	await db.insert(tables.userOrganization).values({
		userId: USER_ID,
		organizationId: ORG_ID,
		role: "owner",
	});
}

async function addSecondMember() {
	await db.insert(tables.user).values({
		id: "second-user-id",
		name: "Second User",
		email: "second@example.com",
		emailVerified: true,
	});
	await db.insert(tables.userOrganization).values({
		userId: "second-user-id",
		organizationId: ORG_ID,
		role: "owner",
	});
}

function getOrg() {
	return db.query.organization.findFirst({
		where: { id: { eq: ORG_ID } },
	});
}

function deleteAccount(token: string) {
	return app.request("/user/me", {
		method: "DELETE",
		headers: { Cookie: token },
	});
}

describe("account deletion cancels subscriptions", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		stripeMock.subscriptions.cancel.mockReset();
		stripeMock.subscriptions.cancel.mockResolvedValue({ status: "canceled" });
		stripeMock.customers.del.mockReset();
		stripeMock.customers.del.mockResolvedValue({ deleted: true });
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("cancels every subscription of an organization the user is the last member of", async () => {
		await seedOrg({
			kind: "default",
			plan: "pro",
			stripeSubscriptionId: "sub_pro",
			devPlan: "max",
			devPlanStripeSubscriptionId: "sub_devpass",
			chatPlan: "plus",
			chatPlanStripeSubscriptionId: "sub_chat",
		});

		const res = await deleteAccount(token);
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.cancelledSubscriptions).toBe(3);
		// The seeded org plus the "Default Organization" created on sign-in — the
		// user is the only member of both.
		expect(json.closedOrganizations).toBe(2);

		const cancelledIds = stripeMock.subscriptions.cancel.mock.calls.map(
			(call) => call[0],
		);
		expect(cancelledIds).toEqual(["sub_pro", "sub_devpass", "sub_chat"]);

		const org = await getOrg();
		expect(org?.status).toBe("deleted");
		expect(org?.plan).toBe("free");
		expect(org?.stripeSubscriptionId).toBeNull();
		expect(org?.subscriptionCancelled).toBe(true);
		expect(org?.devPlan).toBe("none");
		expect(org?.devPlanStripeSubscriptionId).toBeNull();
		expect(org?.devPlanCancelled).toBe(true);
		expect(org?.chatPlan).toBe("none");
		expect(org?.chatPlanStripeSubscriptionId).toBeNull();
		expect(org?.chatPlanCancelled).toBe(true);
	});

	test("cancels the DevPass subscription of the user's personal organization", async () => {
		await seedOrg({
			devPlan: "pro",
			devPlanStripeSubscriptionId: "sub_devpass",
		});

		const res = await deleteAccount(token);
		expect(res.status).toBe(200);

		expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith(
			"sub_devpass",
			{
				invoice_now: false,
				prorate: false,
			},
		);
	});

	test("leaves an organization that still has other members untouched", async () => {
		await seedOrg({
			kind: "default",
			plan: "pro",
			stripeSubscriptionId: "sub_pro",
		});
		await addSecondMember();

		const res = await deleteAccount(token);
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.cancelledSubscriptions).toBe(0);
		expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();

		const org = await getOrg();
		expect(org?.status).toBe("active");
		expect(org?.stripeSubscriptionId).toBe("sub_pro");
		expect(org?.plan).toBe("pro");
	});

	test("treats an already-cancelled subscription as success", async () => {
		await seedOrg({ devPlan: "pro", devPlanStripeSubscriptionId: "sub_gone" });

		stripeMock.subscriptions.cancel.mockRejectedValue(
			new Stripe.errors.StripeInvalidRequestError({
				type: "invalid_request_error",
				code: "resource_missing",
				message: "No such subscription: sub_gone",
			}),
		);

		const res = await deleteAccount(token);
		expect(res.status).toBe(200);

		const deletedUser = await db.query.user.findFirst({
			where: { id: { eq: USER_ID } },
		});
		expect(deletedUser).toBeUndefined();

		const org = await getOrg();
		expect(org?.status).toBe("deleted");
	});

	test("keeps the account when Stripe cancellation fails", async () => {
		await seedOrg({
			devPlan: "pro",
			devPlanStripeSubscriptionId: "sub_devpass",
		});

		stripeMock.subscriptions.cancel.mockRejectedValue(
			new Stripe.errors.StripeAPIError({
				type: "api_error",
				message: "Stripe is down",
			}),
		);

		const res = await deleteAccount(token);
		expect(res.status).not.toBe(200);

		const user = await db.query.user.findFirst({
			where: { id: { eq: USER_ID } },
		});
		expect(user).toBeDefined();

		const org = await getOrg();
		expect(org?.status).toBe("active");
		expect(org?.devPlanStripeSubscriptionId).toBe("sub_devpass");
	});

	test("deletes the Stripe customer and clears the stored id", async () => {
		await seedOrg({ stripeCustomerId: "cus_personal" });

		const res = await deleteAccount(token);
		expect(res.status).toBe(200);

		expect(stripeMock.customers.del).toHaveBeenCalledWith("cus_personal");

		const org = await getOrg();
		expect(org?.stripeCustomerId).toBeNull();
	});

	test("cancels subscriptions before deleting the Stripe customer", async () => {
		const calls: string[] = [];
		stripeMock.subscriptions.cancel.mockImplementation(async () => {
			calls.push("cancel");
			return { status: "canceled" };
		});
		stripeMock.customers.del.mockImplementation(async () => {
			calls.push("del");
			return { deleted: true };
		});

		await seedOrg({
			devPlan: "pro",
			devPlanStripeSubscriptionId: "sub_devpass",
			stripeCustomerId: "cus_personal",
		});

		const res = await deleteAccount(token);
		expect(res.status).toBe(200);
		expect(calls).toEqual(["cancel", "del"]);
	});

	test("treats an already-deleted Stripe customer as success", async () => {
		await seedOrg({ stripeCustomerId: "cus_gone" });

		stripeMock.customers.del.mockRejectedValue(
			new Stripe.errors.StripeInvalidRequestError({
				type: "invalid_request_error",
				code: "resource_missing",
				message: "No such customer: cus_gone",
			}),
		);

		const res = await deleteAccount(token);
		expect(res.status).toBe(200);

		const deletedUser = await db.query.user.findFirst({
			where: { id: { eq: USER_ID } },
		});
		expect(deletedUser).toBeUndefined();
	});

	test("keeps the account when the Stripe customer delete fails", async () => {
		await seedOrg({ stripeCustomerId: "cus_personal" });

		stripeMock.customers.del.mockRejectedValue(
			new Stripe.errors.StripeAPIError({
				type: "api_error",
				message: "Stripe is down",
			}),
		);

		const res = await deleteAccount(token);
		expect(res.status).not.toBe(200);

		const user = await db.query.user.findFirst({
			where: { id: { eq: USER_ID } },
		});
		expect(user).toBeDefined();

		const org = await getOrg();
		expect(org?.stripeCustomerId).toBe("cus_personal");
	});

	test("overwrites the organization name, billing email and logo", async () => {
		await seedOrg({
			kind: "default",
			name: "Jane Doe",
			billingEmail: "jane@example.com",
			logo: "data:image/png;base64,AAAA",
		});

		const res = await deleteAccount(token);
		expect(res.status).toBe(200);

		const org = await getOrg();
		expect(org?.name).toBe(DELETED_ORGANIZATION_NAME);
		expect(org?.billingEmail).toBe(DELETED_ORGANIZATION_BILLING_EMAIL);
		expect(org?.logo).toBeNull();
	});

	test("keeps the statutory bill-to identity on the accounting record", async () => {
		await seedOrg({
			kind: "default",
			billingCompany: "Doe Ltd",
			billingAddress: "1 Example Street\n10115 Berlin",
			billingTaxId: "DE123456789",
		});

		const res = await deleteAccount(token);
		expect(res.status).toBe(200);

		const org = await getOrg();
		expect(org?.billingCompany).toBe("Doe Ltd");
		expect(org?.billingAddress).toBe("1 Example Street\n10115 Berlin");
		expect(org?.billingTaxId).toBe("DE123456789");
	});

	test("leaves the identifiers of an organization with other members alone", async () => {
		await seedOrg({
			kind: "default",
			name: "Shared Team",
			billingEmail: "team@example.com",
		});
		await addSecondMember();

		const res = await deleteAccount(token);
		expect(res.status).toBe(200);

		const org = await getOrg();
		expect(org?.name).toBe("Shared Team");
		expect(org?.billingEmail).toBe("team@example.com");
	});

	test("nulls the deleted user's email on retained payment failures", async () => {
		await seedOrg({ kind: "default" });
		await db.insert(tables.paymentFailure).values({
			organizationId: ORG_ID,
			userEmail: "admin@example.com",
			amount: "10.00",
			declineCode: "insufficient_funds",
			source: "auto_topup",
		});

		const res = await deleteAccount(token);
		expect(res.status).toBe(200);

		const failures = await db.query.paymentFailure.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(failures).toHaveLength(1);
		expect(failures[0].userEmail).toBeNull();
		// The accounting facts survive — only the contact address is removed.
		expect(failures[0].amount).toBe("10.00");
		expect(failures[0].declineCode).toBe("insufficient_funds");
	});

	test("deletion preview reports what will be cancelled", async () => {
		await seedOrg({
			devPlan: "pro",
			devPlanStripeSubscriptionId: "sub_devpass",
		});

		const res = await app.request("/user/me/deletion-preview", {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.activeSubscriptions).toBe(1);
		expect(
			json.organizations.find((org: { id: string }) => org.id === ORG_ID),
		).toMatchObject({
			id: ORG_ID,
			kind: "devpass",
			devPlan: "pro",
			activeSubscriptions: 1,
		});
	});

	test("deletion preview flags credit balances that would be forfeited", async () => {
		await seedOrg({ credits: "12.34" });

		const res = await app.request("/user/me/deletion-preview", {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.forfeitedCredits).toBe("12.34");
		expect(
			json.organizations.find((org: { id: string }) => org.id === ORG_ID),
		).toMatchObject({
			credits: "12.34",
			hasForfeitableCredits: true,
		});
	});

	test("deletion preview does not flag balances under $1", async () => {
		await seedOrg({ credits: "0.99" });

		const res = await app.request("/user/me/deletion-preview", {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(
			json.organizations.find((org: { id: string }) => org.id === ORG_ID),
		).toMatchObject({
			hasForfeitableCredits: false,
		});
	});

	test("deletion preview omits organizations with other members", async () => {
		await seedOrg({
			kind: "default",
			plan: "pro",
			stripeSubscriptionId: "sub_pro",
		});
		await addSecondMember();

		const res = await app.request("/user/me/deletion-preview", {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.activeSubscriptions).toBe(0);
		expect(
			json.organizations.find((org: { id: string }) => org.id === ORG_ID),
		).toBeUndefined();
	});
});

describe("getOrganizationSubscriptionIds", () => {
	test("returns all three subscription slots in a stable order", () => {
		expect(
			getOrganizationSubscriptionIds({
				stripeSubscriptionId: "sub_pro",
				devPlanStripeSubscriptionId: "sub_devpass",
				chatPlanStripeSubscriptionId: "sub_chat",
			}),
		).toEqual(["sub_pro", "sub_devpass", "sub_chat"]);
	});

	test("skips the slots that are empty", () => {
		expect(
			getOrganizationSubscriptionIds({
				stripeSubscriptionId: null,
				devPlanStripeSubscriptionId: "sub_devpass",
				chatPlanStripeSubscriptionId: null,
			}),
		).toEqual(["sub_devpass"]);
	});

	test("returns nothing for an organization with no subscriptions", () => {
		expect(
			getOrganizationSubscriptionIds({
				stripeSubscriptionId: null,
				devPlanStripeSubscriptionId: null,
				chatPlanStripeSubscriptionId: null,
			}),
		).toEqual([]);
	});
});

describe("cancelOrganizationSubscriptions", () => {
	beforeEach(() => {
		stripeMock.subscriptions.cancel.mockReset();
		stripeMock.subscriptions.cancel.mockResolvedValue({ status: "canceled" });
	});

	test("cancels immediately without a proration invoice", async () => {
		const cancelled = await cancelOrganizationSubscriptions({
			stripeSubscriptionId: "sub_pro",
			devPlanStripeSubscriptionId: null,
			chatPlanStripeSubscriptionId: null,
		});

		expect(cancelled).toEqual(["sub_pro"]);
		expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith("sub_pro", {
			invoice_now: false,
			prorate: false,
		});
	});

	test("does not call Stripe when there is nothing to cancel", async () => {
		const cancelled = await cancelOrganizationSubscriptions({
			stripeSubscriptionId: null,
			devPlanStripeSubscriptionId: null,
			chatPlanStripeSubscriptionId: null,
		});

		expect(cancelled).toEqual([]);
		expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
	});

	test.each([
		["resource_missing", "No such subscription: sub_x"],
		[undefined, "This subscription has already been canceled"],
		[undefined, "A subscription which is already canceled cannot be updated"],
	])(
		"treats a terminal subscription as cancelled (code %s)",
		async (code, message) => {
			stripeMock.subscriptions.cancel.mockRejectedValue(
				new Stripe.errors.StripeInvalidRequestError({
					type: "invalid_request_error",
					code,
					message,
				}),
			);

			await expect(
				cancelOrganizationSubscriptions({
					stripeSubscriptionId: "sub_x",
					devPlanStripeSubscriptionId: null,
					chatPlanStripeSubscriptionId: null,
				}),
			).resolves.toEqual(["sub_x"]);
		},
	);

	test("re-throws a genuine Stripe failure instead of swallowing it", async () => {
		stripeMock.subscriptions.cancel.mockRejectedValue(
			new Stripe.errors.StripeAPIError({
				type: "api_error",
				message: "Stripe is down",
			}),
		);

		await expect(
			cancelOrganizationSubscriptions({
				stripeSubscriptionId: "sub_pro",
				devPlanStripeSubscriptionId: null,
				chatPlanStripeSubscriptionId: null,
			}),
		).rejects.toThrow("Stripe is down");
	});

	test("stops at the first genuine failure rather than continuing", async () => {
		stripeMock.subscriptions.cancel
			.mockResolvedValueOnce({ status: "canceled" })
			.mockRejectedValueOnce(
				new Stripe.errors.StripeAPIError({
					type: "api_error",
					message: "Stripe is down",
				}),
			);

		await expect(
			cancelOrganizationSubscriptions({
				stripeSubscriptionId: "sub_pro",
				devPlanStripeSubscriptionId: "sub_devpass",
				chatPlanStripeSubscriptionId: "sub_chat",
			}),
		).rejects.toThrow("Stripe is down");

		// The third slot must not have been attempted after the failure.
		expect(stripeMock.subscriptions.cancel).toHaveBeenCalledTimes(2);
	});
});

describe("findSoleMemberOrganizations", () => {
	beforeEach(async () => {
		await deleteAll();
		await db.insert(tables.user).values({
			id: USER_ID,
			name: "Test User",
			email: "admin@example.com",
			emailVerified: true,
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("returns nothing for a user with no memberships", async () => {
		await expect(findSoleMemberOrganizations(USER_ID)).resolves.toEqual([]);
	});

	test("returns an organization whose only member is the user", async () => {
		await seedOrg({ devPlanStripeSubscriptionId: "sub_devpass", credits: "5" });

		const organizations = await findSoleMemberOrganizations(USER_ID);

		expect(organizations).toHaveLength(1);
		expect(organizations[0]).toMatchObject({
			id: ORG_ID,
			kind: "devpass",
			credits: "5",
			hasForfeitableCredits: true,
			subscriptionIds: ["sub_devpass"],
		});
	});

	test("excludes an organization that has another member", async () => {
		await seedOrg();
		await addSecondMember();

		await expect(findSoleMemberOrganizations(USER_ID)).resolves.toEqual([]);
	});

	test("excludes an organization that is already deleted", async () => {
		await seedOrg({ status: "deleted" });

		await expect(findSoleMemberOrganizations(USER_ID)).resolves.toEqual([]);
	});

	test("keeps sole-member orgs while dropping shared ones", async () => {
		await seedOrg();
		await addSecondMember();
		await db.insert(tables.organization).values({
			id: "solo-org-id",
			name: "Solo",
			billingEmail: "admin@example.com",
		});
		await db.insert(tables.userOrganization).values({
			userId: USER_ID,
			organizationId: "solo-org-id",
			role: "owner",
		});

		const organizations = await findSoleMemberOrganizations(USER_ID);

		expect(organizations.map((org) => org.id)).toEqual(["solo-org-id"]);
	});

	test.each([
		["0", false],
		["0.99", false],
		["1", true],
		["1.00", true],
		["12.34", true],
	])("flags a %s balance as forfeitable: %s", async (credits, expected) => {
		await seedOrg({ credits });

		const [organization] = await findSoleMemberOrganizations(USER_ID);

		expect(organization.hasForfeitableCredits).toBe(expected);
	});
});

describe("tearDownSoleMemberOrganizations", () => {
	beforeEach(async () => {
		await deleteAll();
		await db.insert(tables.user).values({
			id: USER_ID,
			name: "Test User",
			email: "admin@example.com",
			emailVerified: true,
		});
		stripeMock.subscriptions.cancel.mockReset();
		stripeMock.subscriptions.cancel.mockResolvedValue({ status: "canceled" });
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("cancels every slot and clears the organization's plan state", async () => {
		await seedOrg({
			kind: "default",
			plan: "pro",
			planExpiresAt: null,
			isTrialActive: true,
			autoTopUpEnabled: true,
			stripeSubscriptionId: "sub_pro",
			devPlan: "max",
			devPlanStripeSubscriptionId: "sub_devpass",
			devPlanPendingTier: "lite",
			chatPlan: "plus",
			chatPlanStripeSubscriptionId: "sub_chat",
		});

		const closed = await tearDownSoleMemberOrganizations(USER_ID);

		expect(closed.map((org) => org.id)).toEqual([ORG_ID]);
		expect(stripeMock.subscriptions.cancel).toHaveBeenCalledTimes(3);

		const org = await getOrg();
		expect(org).toMatchObject({
			status: "deleted",
			plan: "free",
			stripeSubscriptionId: null,
			subscriptionCancelled: true,
			isTrialActive: false,
			autoTopUpEnabled: false,
			devPlan: "none",
			devPlanStripeSubscriptionId: null,
			devPlanCancelled: true,
			devPlanPendingTier: null,
			chatPlan: "none",
			chatPlanStripeSubscriptionId: null,
			chatPlanCancelled: true,
		});
		expect(org?.planExpiresAt).toBeInstanceOf(Date);
		expect(org?.devPlanExpiresAt).toBeInstanceOf(Date);
		expect(org?.chatPlanExpiresAt).toBeInstanceOf(Date);
	});

	test("closes a sole-member org that has no subscription at all", async () => {
		await seedOrg();

		const closed = await tearDownSoleMemberOrganizations(USER_ID);

		expect(closed.map((org) => org.id)).toEqual([ORG_ID]);
		expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
		expect((await getOrg())?.status).toBe("deleted");
	});

	test("leaves a shared organization fully intact", async () => {
		await seedOrg({
			kind: "default",
			plan: "pro",
			stripeSubscriptionId: "sub_pro",
		});
		await addSecondMember();

		await expect(tearDownSoleMemberOrganizations(USER_ID)).resolves.toEqual([]);

		expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
		expect(await getOrg()).toMatchObject({
			status: "active",
			plan: "pro",
			stripeSubscriptionId: "sub_pro",
		});
	});

	test("leaves local state untouched when Stripe cancellation fails", async () => {
		await seedOrg({
			devPlan: "pro",
			devPlanStripeSubscriptionId: "sub_devpass",
		});

		stripeMock.subscriptions.cancel.mockRejectedValue(
			new Stripe.errors.StripeAPIError({
				type: "api_error",
				message: "Stripe is down",
			}),
		);

		await expect(tearDownSoleMemberOrganizations(USER_ID)).rejects.toThrow(
			"Stripe is down",
		);

		expect(await getOrg()).toMatchObject({
			status: "active",
			devPlan: "pro",
			devPlanStripeSubscriptionId: "sub_devpass",
			devPlanCancelled: false,
		});
	});

	test("does not cancel a second org's subscription when the first fails", async () => {
		await seedOrg({ devPlanStripeSubscriptionId: "sub_devpass" });
		await db.insert(tables.organization).values({
			id: "second-org-id",
			name: "Second",
			billingEmail: "admin@example.com",
			plan: "pro",
			stripeSubscriptionId: "sub_second",
			// Explicitly younger than the seeded org so teardown reaches it second.
			createdAt: new Date(Date.now() + 60_000),
		});
		await db.insert(tables.userOrganization).values({
			userId: USER_ID,
			organizationId: "second-org-id",
			role: "owner",
		});

		stripeMock.subscriptions.cancel.mockRejectedValue(
			new Stripe.errors.StripeAPIError({
				type: "api_error",
				message: "Stripe is down",
			}),
		);

		await expect(tearDownSoleMemberOrganizations(USER_ID)).rejects.toThrow(
			"Stripe is down",
		);

		const cancelledIds = stripeMock.subscriptions.cancel.mock.calls.map(
			(call) => call[0],
		);
		expect(cancelledIds).not.toContain("sub_second");
	});
});

describe("anonymizeBillingRecordsForEmail", () => {
	beforeEach(async () => {
		await deleteAll();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Shared Team",
			billingEmail: "team@example.com",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("clears the email on rows of an organization that survives the deletion", async () => {
		await db.insert(tables.paymentFailure).values([
			{ organizationId: ORG_ID, userEmail: "leaver@example.com" },
			{ organizationId: ORG_ID, userEmail: "stays@example.com" },
		]);

		expect(await anonymizeBillingRecordsForEmail("leaver@example.com")).toBe(1);

		const failures = await db.query.paymentFailure.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(failures.map((failure) => failure.userEmail)).toEqual(
			expect.arrayContaining([null, "stays@example.com"]),
		);
		expect(failures).toHaveLength(2);
	});

	test("is a no-op when the user never triggered a payment failure", async () => {
		expect(await anonymizeBillingRecordsForEmail("nobody@example.com")).toBe(0);
	});

	test("clears rows on a closing organization whatever address they carry", async () => {
		// `payment_failure` stores the email as it was at the time, so a user who
		// changed address leaves rows the current-email match cannot find. Sweeping
		// the organizations being closed is what catches them.
		await db.insert(tables.paymentFailure).values([
			{ organizationId: ORG_ID, userEmail: "old-address@example.com" },
			{ organizationId: ORG_ID, userEmail: "current@example.com" },
		]);

		expect(
			await anonymizeBillingRecordsForEmail("current@example.com", [ORG_ID]),
		).toBe(2);

		const failures = await db.query.paymentFailure.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(failures.every((failure) => failure.userEmail === null)).toBe(true);
	});
});
