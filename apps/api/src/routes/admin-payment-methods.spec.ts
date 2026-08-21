import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import type * as PaymentsModule from "@/routes/payments.js";

const stripeMock = vi.hoisted(() => ({
	paymentMethods: {
		list: vi.fn(),
		retrieve: vi.fn(),
		detach: vi.fn(),
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

async function request(path = "", init?: RequestInit) {
	return await app.request(
		`/admin/organizations/${ORG_ID}/payment-methods${path}`,
		init,
	);
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

		stripeMock.paymentMethods.list.mockResolvedValue({ data: [] });
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

		const response = await request(`/${STRIPE_PAYMENT_METHOD_ID}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});

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

	it("refuses to detach a method belonging to another customer", async () => {
		stripeMock.paymentMethods.retrieve.mockResolvedValue({
			id: STRIPE_PAYMENT_METHOD_ID,
			customer: "cus_someone_else",
			type: "card",
			card: { last4: "4242" },
		});

		const response = await request(`/${STRIPE_PAYMENT_METHOD_ID}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});

		expect(response.status).toBe(404);
		expect(stripeMock.paymentMethods.detach).not.toHaveBeenCalled();
	});
});
