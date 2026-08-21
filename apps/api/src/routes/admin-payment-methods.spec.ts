import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import type * as PaymentsModule from "@/routes/payments.js";

const stripeMock = vi.hoisted(() => ({
	customers: {
		retrieve: vi.fn(),
		update: vi.fn(),
	},
	paymentMethods: {
		list: vi.fn(),
		retrieve: vi.fn(),
		detach: vi.fn(),
	},
	subscriptions: {
		retrieve: vi.fn(),
		update: vi.fn(),
	},
}));

vi.mock("@/routes/payments.js", async (importOriginal) => {
	const original = await importOriginal<typeof PaymentsModule>();
	return {
		...original,
		getStripe: () => stripeMock,
	};
});

const originalAdminEmails = process.env.ADMIN_EMAILS;
const ORG_ID = "admin-payment-methods-org";
const STRIPE_CUSTOMER_ID = "cus_admin_payment_methods";
const STRIPE_PAYMENT_METHOD_ID = "pm_admin_payment_method";
const REPLACEMENT_PAYMENT_METHOD_ID = "pm_admin_replacement";
const SUBSCRIPTION_ID = "sub_admin_payment_methods";

async function request(path = "", init?: RequestInit) {
	return await app.request(
		`/admin/organizations/${ORG_ID}/payment-methods${path}`,
		init,
	);
}

async function deletePaymentMethod(
	cookie: string,
	paymentMethodId = STRIPE_PAYMENT_METHOD_ID,
	replacementPaymentMethodId?: string,
) {
	return await request(`/${paymentMethodId}`, {
		method: "DELETE",
		headers: { Cookie: cookie, "Content-Type": "application/json" },
		body: JSON.stringify({ replacementPaymentMethodId }),
	});
}

describe("admin organization payment methods", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		vi.clearAllMocks();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Admin Payment Methods Org",
			billingEmail: "payments@test.example",
			stripeCustomerId: STRIPE_CUSTOMER_ID,
		});

		stripeMock.customers.retrieve.mockResolvedValue({
			id: STRIPE_CUSTOMER_ID,
			deleted: false,
			invoice_settings: { default_payment_method: null },
		});
		stripeMock.customers.update.mockResolvedValue({
			id: STRIPE_CUSTOMER_ID,
		});
		stripeMock.paymentMethods.list.mockResolvedValue({
			data: [
				{
					id: STRIPE_PAYMENT_METHOD_ID,
					type: "card",
					created: 1_893_456_000,
					card: {
						brand: "visa",
						last4: "4242",
						exp_month: 12,
						exp_year: 2030,
					},
				},
			],
		});
		stripeMock.paymentMethods.retrieve.mockResolvedValue({
			id: STRIPE_PAYMENT_METHOD_ID,
			customer: STRIPE_CUSTOMER_ID,
			type: "card",
			card: {
				brand: "visa",
				last4: "4242",
				exp_month: 12,
				exp_year: 2030,
			},
		});
		stripeMock.paymentMethods.detach.mockResolvedValue({
			id: STRIPE_PAYMENT_METHOD_ID,
		});
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			default_payment_method: null,
		});
		stripeMock.subscriptions.update.mockResolvedValue({
			id: SUBSCRIPTION_ID,
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

	it("lists cards attached to the Stripe customer", async () => {
		stripeMock.customers.retrieve.mockResolvedValue({
			id: STRIPE_CUSTOMER_ID,
			deleted: false,
			invoice_settings: {
				default_payment_method: STRIPE_PAYMENT_METHOD_ID,
			},
		});
		stripeMock.paymentMethods.list.mockResolvedValue({
			data: [
				{
					id: STRIPE_PAYMENT_METHOD_ID,
					type: "card",
					created: 1_893_456_000,
					card: {
						brand: "visa",
						last4: "4242",
						exp_month: 12,
						exp_year: 2030,
					},
				},
			],
		});

		const response = await request("", { headers: { Cookie: cookie } });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			paymentMethods: [
				{
					id: STRIPE_PAYMENT_METHOD_ID,
					type: "card",
					createdAt: "2030-01-01T00:00:00.000Z",
					isDefault: true,
					card: {
						brand: "visa",
						last4: "4242",
						expiryMonth: 12,
						expiryYear: 2030,
					},
				},
			],
		});
		expect(stripeMock.paymentMethods.list).toHaveBeenCalledWith({
			customer: STRIPE_CUSTOMER_ID,
			limit: 100,
		});
	});

	it("returns an empty list when the organization has no Stripe customer", async () => {
		await db
			.update(tables.organization)
			.set({ stripeCustomerId: null })
			.where(eq(tables.organization.id, ORG_ID));

		const response = await request("", { headers: { Cookie: cookie } });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ paymentMethods: [] });
		expect(stripeMock.paymentMethods.list).not.toHaveBeenCalled();
	});

	it("lists every page of attached payment methods", async () => {
		stripeMock.paymentMethods.list
			.mockResolvedValueOnce({
				data: [{ id: STRIPE_PAYMENT_METHOD_ID, type: "card", created: 1 }],
				has_more: true,
			})
			.mockResolvedValueOnce({
				data: [{ id: REPLACEMENT_PAYMENT_METHOD_ID, type: "card", created: 2 }],
				has_more: false,
			});

		const response = await request("", { headers: { Cookie: cookie } });

		expect(response.status).toBe(200);
		expect((await response.json()).paymentMethods).toHaveLength(2);
		expect(stripeMock.paymentMethods.list).toHaveBeenNthCalledWith(2, {
			customer: STRIPE_CUSTOMER_ID,
			limit: 100,
			starting_after: STRIPE_PAYMENT_METHOD_ID,
		});
	});

	it("does not use another organization's local default", async () => {
		await db.insert(tables.organization).values({
			id: "other-payment-method-org",
			name: "Other Payment Method Org",
			billingEmail: "other-payments@test.example",
		});
		await db.insert(tables.paymentMethod).values({
			organizationId: "other-payment-method-org",
			stripePaymentMethodId: STRIPE_PAYMENT_METHOD_ID,
			type: "card",
			isDefault: true,
		});

		const response = await request("", { headers: { Cookie: cookie } });

		expect(response.status).toBe(200);
		expect((await response.json()).paymentMethods[0]).toMatchObject({
			id: STRIPE_PAYMENT_METHOD_ID,
			isDefault: false,
		});
	});

	it("ignores a missing stored Stripe subscription when listing methods", async () => {
		await db
			.update(tables.organization)
			.set({ stripeSubscriptionId: SUBSCRIPTION_ID })
			.where(eq(tables.organization.id, ORG_ID));
		stripeMock.subscriptions.retrieve.mockRejectedValue(
			new Stripe.errors.StripeInvalidRequestError({
				type: "invalid_request_error",
				code: "resource_missing",
				message: `No such subscription: ${SUBSCRIPTION_ID}`,
			}),
		);

		const response = await request("", { headers: { Cookie: cookie } });

		expect(response.status).toBe(200);
		expect((await response.json()).paymentMethods).toHaveLength(1);
	});

	it("detaches the Stripe method and removes its local reference", async () => {
		await db.insert(tables.paymentMethod).values({
			id: "local-payment-method",
			organizationId: ORG_ID,
			stripePaymentMethodId: STRIPE_PAYMENT_METHOD_ID,
			type: "card",
			isDefault: true,
		});

		const response = await deletePaymentMethod(cookie);

		expect(response.status).toBe(200);
		expect(stripeMock.paymentMethods.detach).toHaveBeenCalledWith(
			STRIPE_PAYMENT_METHOD_ID,
		);
		expect(
			await db.query.paymentMethod.findFirst({
				where: { id: { eq: "local-payment-method" } },
			}),
		).toBeUndefined();

		const auditLog = await db.query.auditLog.findFirst({
			where: {
				organizationId: { eq: ORG_ID },
				action: { eq: "payment.method.delete" },
			},
		});
		expect(auditLog).toMatchObject({
			resourceId: STRIPE_PAYMENT_METHOD_ID,
			metadata: { cardLast4: "4242" },
		});
	});

	it("requires an attached replacement before deleting a default method", async () => {
		stripeMock.customers.retrieve.mockResolvedValue({
			id: STRIPE_CUSTOMER_ID,
			deleted: false,
			invoice_settings: {
				default_payment_method: STRIPE_PAYMENT_METHOD_ID,
			},
		});
		stripeMock.paymentMethods.list.mockResolvedValue({
			data: [
				{ id: STRIPE_PAYMENT_METHOD_ID, type: "card" },
				{ id: REPLACEMENT_PAYMENT_METHOD_ID, type: "card" },
			],
		});

		const response = await deletePaymentMethod(cookie);

		expect(response.status).toBe(400);
		expect(stripeMock.customers.update).not.toHaveBeenCalled();
		expect(stripeMock.paymentMethods.detach).not.toHaveBeenCalled();
	});

	it("rejects a replacement that is not attached to the customer", async () => {
		stripeMock.customers.retrieve.mockResolvedValue({
			id: STRIPE_CUSTOMER_ID,
			deleted: false,
			invoice_settings: {
				default_payment_method: STRIPE_PAYMENT_METHOD_ID,
			},
		});
		stripeMock.paymentMethods.list.mockResolvedValue({
			data: [
				{ id: STRIPE_PAYMENT_METHOD_ID, type: "card" },
				{ id: REPLACEMENT_PAYMENT_METHOD_ID, type: "card" },
			],
		});

		const response = await deletePaymentMethod(
			cookie,
			STRIPE_PAYMENT_METHOD_ID,
			"pm_not_attached",
		);

		expect(response.status).toBe(400);
		expect(stripeMock.paymentMethods.detach).not.toHaveBeenCalled();
	});

	it("moves Stripe and local defaults before detaching the default method", async () => {
		await db
			.update(tables.organization)
			.set({
				autoTopUpEnabled: true,
				stripeSubscriptionId: SUBSCRIPTION_ID,
			})
			.where(eq(tables.organization.id, ORG_ID));
		await db.insert(tables.paymentMethod).values([
			{
				id: "local-target-payment-method",
				organizationId: ORG_ID,
				stripePaymentMethodId: STRIPE_PAYMENT_METHOD_ID,
				type: "card",
				isDefault: false,
			},
			{
				id: "local-replacement-payment-method",
				organizationId: ORG_ID,
				stripePaymentMethodId: REPLACEMENT_PAYMENT_METHOD_ID,
				type: "card",
				isDefault: false,
			},
			{
				id: "local-stale-default-payment-method",
				organizationId: ORG_ID,
				stripePaymentMethodId: "pm_local_stale_default",
				type: "card",
				isDefault: true,
			},
		]);
		stripeMock.customers.retrieve.mockResolvedValue({
			id: STRIPE_CUSTOMER_ID,
			deleted: false,
			invoice_settings: {
				default_payment_method: STRIPE_PAYMENT_METHOD_ID,
			},
		});
		stripeMock.paymentMethods.list.mockResolvedValue({
			data: [
				{ id: STRIPE_PAYMENT_METHOD_ID, type: "card" },
				{ id: REPLACEMENT_PAYMENT_METHOD_ID, type: "card" },
			],
		});
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			default_payment_method: STRIPE_PAYMENT_METHOD_ID,
		});

		const response = await deletePaymentMethod(
			cookie,
			STRIPE_PAYMENT_METHOD_ID,
			REPLACEMENT_PAYMENT_METHOD_ID,
		);

		expect(response.status).toBe(200);
		expect(stripeMock.customers.update).toHaveBeenCalledWith(
			STRIPE_CUSTOMER_ID,
			{
				invoice_settings: {
					default_payment_method: REPLACEMENT_PAYMENT_METHOD_ID,
				},
			},
		);
		expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
			SUBSCRIPTION_ID,
			{ default_payment_method: REPLACEMENT_PAYMENT_METHOD_ID },
		);
		expect(
			stripeMock.customers.update.mock.invocationCallOrder[0],
		).toBeLessThan(
			stripeMock.paymentMethods.detach.mock.invocationCallOrder[0],
		);
		expect(
			stripeMock.subscriptions.update.mock.invocationCallOrder[0],
		).toBeLessThan(
			stripeMock.paymentMethods.detach.mock.invocationCallOrder[0],
		);

		const replacement = await db.query.paymentMethod.findFirst({
			where: { id: { eq: "local-replacement-payment-method" } },
		});
		expect(replacement?.isDefault).toBe(true);
		expect(
			await db.query.paymentMethod.findFirst({
				where: { id: { eq: "local-target-payment-method" } },
			}),
		).toBeUndefined();
		expect(
			await db.query.paymentMethod.findFirst({
				where: { id: { eq: "local-stale-default-payment-method" } },
			}),
		).toMatchObject({ isDefault: false });
		expect(
			await db.query.organization.findFirst({
				where: { id: { eq: ORG_ID } },
			}),
		).toMatchObject({ autoTopUpEnabled: true });
	});

	it("keeps non-card methods and auto top-up when replacing the last card", async () => {
		await db
			.update(tables.organization)
			.set({ autoTopUpEnabled: true })
			.where(eq(tables.organization.id, ORG_ID));
		stripeMock.customers.retrieve.mockResolvedValue({
			id: STRIPE_CUSTOMER_ID,
			deleted: false,
			invoice_settings: {
				default_payment_method: STRIPE_PAYMENT_METHOD_ID,
			},
		});
		stripeMock.paymentMethods.list.mockResolvedValue({
			data: [
				{ id: STRIPE_PAYMENT_METHOD_ID, type: "card" },
				{ id: REPLACEMENT_PAYMENT_METHOD_ID, type: "us_bank_account" },
			],
		});

		const response = await deletePaymentMethod(
			cookie,
			STRIPE_PAYMENT_METHOD_ID,
			REPLACEMENT_PAYMENT_METHOD_ID,
		);

		expect(response.status).toBe(200);
		expect(stripeMock.customers.update).toHaveBeenCalledWith(
			STRIPE_CUSTOMER_ID,
			{
				invoice_settings: {
					default_payment_method: REPLACEMENT_PAYMENT_METHOD_ID,
				},
			},
		);
		expect(
			await db.query.organization.findFirst({
				where: { id: { eq: ORG_ID } },
			}),
		).toMatchObject({ autoTopUpEnabled: true });
	});

	it("updates the DevPass fingerprint with its replacement card", async () => {
		await db
			.update(tables.organization)
			.set({
				devPlanStripeSubscriptionId: SUBSCRIPTION_ID,
				devPlanCardFingerprint: "old_fingerprint",
			})
			.where(eq(tables.organization.id, ORG_ID));
		stripeMock.paymentMethods.list.mockResolvedValue({
			data: [
				{ id: STRIPE_PAYMENT_METHOD_ID, type: "card" },
				{
					id: REPLACEMENT_PAYMENT_METHOD_ID,
					type: "card",
					card: { fingerprint: "replacement_fingerprint" },
				},
			],
		});
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			default_payment_method: STRIPE_PAYMENT_METHOD_ID,
		});

		const response = await deletePaymentMethod(
			cookie,
			STRIPE_PAYMENT_METHOD_ID,
			REPLACEMENT_PAYMENT_METHOD_ID,
		);

		expect(response.status).toBe(200);
		expect(
			await db.query.organization.findFirst({
				where: { id: { eq: ORG_ID } },
			}),
		).toMatchObject({ devPlanCardFingerprint: "replacement_fingerprint" });
	});

	it("updates plan fingerprints inherited from the customer default", async () => {
		const chatSubscriptionId = "sub_chat_inherited_payment_method";
		await db
			.update(tables.organization)
			.set({
				devPlanStripeSubscriptionId: SUBSCRIPTION_ID,
				chatPlanStripeSubscriptionId: chatSubscriptionId,
				devPlanCardFingerprint: "old_dev_fingerprint",
				chatPlanCardFingerprint: "old_chat_fingerprint",
			})
			.where(eq(tables.organization.id, ORG_ID));
		stripeMock.customers.retrieve.mockResolvedValue({
			id: STRIPE_CUSTOMER_ID,
			deleted: false,
			invoice_settings: {
				default_payment_method: STRIPE_PAYMENT_METHOD_ID,
			},
		});
		stripeMock.paymentMethods.list.mockResolvedValue({
			data: [
				{ id: STRIPE_PAYMENT_METHOD_ID, type: "card" },
				{
					id: REPLACEMENT_PAYMENT_METHOD_ID,
					type: "card",
					card: { fingerprint: "replacement_fingerprint" },
				},
			],
		});
		stripeMock.subscriptions.retrieve.mockImplementation(
			async (id: string) => ({
				id,
				default_payment_method: null,
			}),
		);

		const response = await deletePaymentMethod(
			cookie,
			STRIPE_PAYMENT_METHOD_ID,
			REPLACEMENT_PAYMENT_METHOD_ID,
		);

		expect(response.status).toBe(200);
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
		expect(
			await db.query.organization.findFirst({
				where: { id: { eq: ORG_ID } },
			}),
		).toMatchObject({
			devPlanCardFingerprint: "replacement_fingerprint",
			chatPlanCardFingerprint: "replacement_fingerprint",
		});
	});

	it("does not update an unaffected plan fingerprint", async () => {
		await db
			.update(tables.organization)
			.set({
				devPlanStripeSubscriptionId: SUBSCRIPTION_ID,
				devPlanCardFingerprint: "existing_fingerprint",
			})
			.where(eq(tables.organization.id, ORG_ID));
		stripeMock.customers.retrieve.mockResolvedValue({
			id: STRIPE_CUSTOMER_ID,
			deleted: false,
			invoice_settings: {
				default_payment_method: REPLACEMENT_PAYMENT_METHOD_ID,
			},
		});
		stripeMock.paymentMethods.list.mockResolvedValue({
			data: [
				{ id: STRIPE_PAYMENT_METHOD_ID, type: "card" },
				{ id: REPLACEMENT_PAYMENT_METHOD_ID, type: "us_bank_account" },
			],
		});
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			default_payment_method: REPLACEMENT_PAYMENT_METHOD_ID,
		});

		const response = await deletePaymentMethod(
			cookie,
			STRIPE_PAYMENT_METHOD_ID,
			REPLACEMENT_PAYMENT_METHOD_ID,
		);

		expect(response.status).toBe(200);
		expect(stripeMock.customers.update).not.toHaveBeenCalled();
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
		expect(
			await db.query.organization.findFirst({
				where: { id: { eq: ORG_ID } },
			}),
		).toMatchObject({ devPlanCardFingerprint: "existing_fingerprint" });
	});

	it("updates a plan fingerprint when retrying after detachment", async () => {
		await db
			.update(tables.organization)
			.set({
				devPlanStripeSubscriptionId: SUBSCRIPTION_ID,
				devPlanCardFingerprint: "old_fingerprint",
			})
			.where(eq(tables.organization.id, ORG_ID));
		await db.insert(tables.paymentMethod).values({
			id: "local-detached-plan-payment-method",
			organizationId: ORG_ID,
			stripePaymentMethodId: STRIPE_PAYMENT_METHOD_ID,
			type: "card",
			isDefault: true,
		});
		stripeMock.paymentMethods.retrieve.mockResolvedValue({
			id: STRIPE_PAYMENT_METHOD_ID,
			customer: null,
			type: "card",
		});
		stripeMock.customers.retrieve.mockResolvedValue({
			id: STRIPE_CUSTOMER_ID,
			deleted: false,
			invoice_settings: {
				default_payment_method: REPLACEMENT_PAYMENT_METHOD_ID,
			},
		});
		stripeMock.paymentMethods.list.mockResolvedValue({
			data: [
				{
					id: REPLACEMENT_PAYMENT_METHOD_ID,
					type: "card",
					card: { fingerprint: "replacement_fingerprint" },
				},
			],
		});
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			default_payment_method: REPLACEMENT_PAYMENT_METHOD_ID,
		});

		const response = await deletePaymentMethod(
			cookie,
			STRIPE_PAYMENT_METHOD_ID,
			REPLACEMENT_PAYMENT_METHOD_ID,
		);

		expect(response.status).toBe(200);
		expect(
			await db.query.organization.findFirst({
				where: { id: { eq: ORG_ID } },
			}),
		).toMatchObject({ devPlanCardFingerprint: "replacement_fingerprint" });
	});

	it("rejects a replacement fingerprint used by another DevPass org", async () => {
		await db
			.update(tables.organization)
			.set({ devPlanStripeSubscriptionId: SUBSCRIPTION_ID })
			.where(eq(tables.organization.id, ORG_ID));
		await db.insert(tables.organization).values({
			id: "other-devpass-fingerprint-org",
			name: "Other DevPass Fingerprint Org",
			billingEmail: "other-devpass@test.example",
			devPlanCardFingerprint: "replacement_fingerprint",
		});
		stripeMock.paymentMethods.list.mockResolvedValue({
			data: [
				{ id: STRIPE_PAYMENT_METHOD_ID, type: "card" },
				{
					id: REPLACEMENT_PAYMENT_METHOD_ID,
					type: "card",
					card: { fingerprint: "replacement_fingerprint" },
				},
			],
		});
		stripeMock.subscriptions.retrieve.mockResolvedValue({
			id: SUBSCRIPTION_ID,
			default_payment_method: STRIPE_PAYMENT_METHOD_ID,
		});

		const response = await deletePaymentMethod(
			cookie,
			STRIPE_PAYMENT_METHOD_ID,
			REPLACEMENT_PAYMENT_METHOD_ID,
		);

		expect(response.status).toBe(409);
		expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
		expect(stripeMock.paymentMethods.detach).not.toHaveBeenCalled();
	});

	it("clears Stripe defaults and disables auto top-up for the last method", async () => {
		const subscriptionIds = [
			"sub_default_payment_methods",
			"sub_devpass_payment_methods",
			"sub_chat_payment_methods",
		];
		await db
			.update(tables.organization)
			.set({
				autoTopUpEnabled: true,
				stripeSubscriptionId: subscriptionIds[0],
				devPlanStripeSubscriptionId: subscriptionIds[1],
				chatPlanStripeSubscriptionId: subscriptionIds[2],
				devPlanCardFingerprint: "dev_fingerprint",
				chatPlanCardFingerprint: "chat_fingerprint",
			})
			.where(eq(tables.organization.id, ORG_ID));
		await db.insert(tables.paymentMethod).values({
			id: "local-last-payment-method",
			organizationId: ORG_ID,
			stripePaymentMethodId: STRIPE_PAYMENT_METHOD_ID,
			type: "card",
			isDefault: true,
		});
		stripeMock.customers.retrieve.mockResolvedValue({
			id: STRIPE_CUSTOMER_ID,
			deleted: false,
			invoice_settings: {
				default_payment_method: STRIPE_PAYMENT_METHOD_ID,
			},
		});
		stripeMock.subscriptions.retrieve.mockImplementation(
			async (id: string) => ({
				id,
				default_payment_method: STRIPE_PAYMENT_METHOD_ID,
			}),
		);

		const response = await deletePaymentMethod(cookie);

		expect(response.status).toBe(200);
		expect(stripeMock.customers.update).toHaveBeenCalledWith(
			STRIPE_CUSTOMER_ID,
			{ invoice_settings: { default_payment_method: "" } },
		);
		for (const subscriptionId of subscriptionIds) {
			expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
				subscriptionId,
				{ default_payment_method: "" },
			);
		}
		expect(
			await db.query.organization.findFirst({
				where: { id: { eq: ORG_ID } },
			}),
		).toMatchObject({
			autoTopUpEnabled: false,
			devPlanCardFingerprint: null,
			chatPlanCardFingerprint: null,
		});
	});

	it("cleans up a local row after Stripe already detached the method", async () => {
		await db.insert(tables.paymentMethod).values({
			id: "local-detached-payment-method",
			organizationId: ORG_ID,
			stripePaymentMethodId: STRIPE_PAYMENT_METHOD_ID,
			type: "card",
			isDefault: true,
		});
		stripeMock.paymentMethods.retrieve.mockResolvedValue({
			id: STRIPE_PAYMENT_METHOD_ID,
			customer: null,
			type: "card",
		});
		stripeMock.paymentMethods.list.mockResolvedValue({ data: [] });

		const response = await deletePaymentMethod(cookie);

		expect(response.status).toBe(200);
		expect(stripeMock.paymentMethods.detach).not.toHaveBeenCalled();
		expect(
			await db.query.paymentMethod.findFirst({
				where: { id: { eq: "local-detached-payment-method" } },
			}),
		).toBeUndefined();
	});

	it("maps a missing Stripe payment method to not found", async () => {
		stripeMock.paymentMethods.retrieve.mockRejectedValue(
			new Stripe.errors.StripeInvalidRequestError({
				type: "invalid_request_error",
				code: "resource_missing",
				message: `No such payment method: ${STRIPE_PAYMENT_METHOD_ID}`,
			}),
		);

		const response = await deletePaymentMethod(cookie);

		expect(response.status).toBe(404);
		expect(stripeMock.paymentMethods.detach).not.toHaveBeenCalled();
	});

	it("refuses to detach a method belonging to another customer", async () => {
		stripeMock.paymentMethods.retrieve.mockResolvedValue({
			id: STRIPE_PAYMENT_METHOD_ID,
			customer: "cus_someone_else",
			type: "card",
			card: { last4: "4242" },
		});

		const response = await request(`/${STRIPE_PAYMENT_METHOD_ID}`, {
			method: "DELETE",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(404);
		expect(stripeMock.paymentMethods.detach).not.toHaveBeenCalled();
	});
});
