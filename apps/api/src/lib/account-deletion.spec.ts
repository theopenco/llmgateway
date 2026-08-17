import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

import {
	cancelOrganizationSubscriptions,
	findSoleMemberOrganizations,
	getOrganizationSubscriptionIds,
	tearDownSoleMemberOrganizations,
} from "./account-deletion.js";

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
