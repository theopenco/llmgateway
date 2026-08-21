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
			id: "sub_admin_payment_methods",
			default_payment_method: null,
		});
		stripeMock.subscriptions.update.mockResolvedValue({
			id: "sub_admin_payment_methods",
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
			type: "card",
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
				id: "local-default-payment-method",
				organizationId: ORG_ID,
				stripePaymentMethodId: STRIPE_PAYMENT_METHOD_ID,
				type: "card",
				isDefault: true,
			},
			{
				id: "local-replacement-payment-method",
				organizationId: ORG_ID,
				stripePaymentMethodId: REPLACEMENT_PAYMENT_METHOD_ID,
				type: "card",
				isDefault: false,
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
				where: { id: { eq: "local-default-payment-method" } },
			}),
		).toBeUndefined();
		expect(
			await db.query.organization.findFirst({
				where: { id: { eq: ORG_ID } },
			}),
		).toMatchObject({ autoTopUpEnabled: true });
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
		).toMatchObject({ autoTopUpEnabled: false });
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
