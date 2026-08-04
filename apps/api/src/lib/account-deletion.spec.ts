import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

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
