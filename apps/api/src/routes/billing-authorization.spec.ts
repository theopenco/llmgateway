import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const stripeMock = vi.hoisted(() => ({
	customers: { update: vi.fn() },
	setupIntents: { create: vi.fn() },
	paymentIntents: { create: vi.fn() },
	paymentMethods: { retrieve: vi.fn() },
}));

vi.mock("stripe", () => ({
	default: function MockStripe() {
		return stripeMock;
	},
}));

const orgId = "test-org-id";
const paymentMethodId = "test-payment-method";

const paymentRequests = [
	{ method: "GET", path: "/payments/top-up-limit" },
	{ method: "GET", path: "/payments/payment-methods" },
	{
		method: "POST",
		path: "/payments/create-payment-intent",
		body: { amount: 10 },
	},
	{ method: "POST", path: "/payments/create-setup-intent", body: {} },
	{
		method: "POST",
		path: "/payments/payment-methods/default",
		body: { paymentMethodId },
	},
	{ method: "DELETE", path: `/payments/payment-methods/${paymentMethodId}` },
	{
		method: "POST",
		path: "/payments/top-up-with-saved-method",
		body: { amount: 10, paymentMethodId },
	},
	{
		method: "POST",
		path: "/payments/create-checkout-session",
		body: { amount: 10 },
	},
	{
		method: "POST",
		path: "/payments/calculate-fees",
		body: { amount: 10, paymentMethodId },
	},
];

describe("billing authorization", () => {
	let token: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_mock");
		vi.stubEnv("GATEWAY_TOPUP_VELOCITY_ENABLED", "false");
		token = await createTestUser();
		await db
			.delete(tables.userOrganization)
			.where(eq(tables.userOrganization.userId, "test-user-id"));
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Test Organization",
			billingEmail: "admin@example.com",
			stripeCustomerId: "cus_test_billing",
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: orgId,
			role: "owner",
		});
		await db.insert(tables.paymentMethod).values({
			id: paymentMethodId,
			organizationId: orgId,
			stripePaymentMethodId: "pm_test_billing",
			type: "card",
			isDefault: true,
		});
		stripeMock.paymentIntents.create.mockResolvedValue({
			id: "pi_test_billing",
			client_secret: "test-payment-secret",
		});
		stripeMock.setupIntents.create.mockResolvedValue({
			client_secret: "test-setup-secret",
		});
		stripeMock.paymentMethods.retrieve.mockResolvedValue({
			card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
		});
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteAll();
	});

	async function setRole(
		role: "owner" | "admin" | "project_admin" | "developer",
	) {
		await db
			.update(tables.userOrganization)
			.set({ role })
			.where(eq(tables.userOrganization.organizationId, orgId));
	}

	describe.each(["developer", "project_admin"] as const)("%s", (role) => {
		test.each(paymentRequests)(
			"cannot use $method $path",
			async ({ method, path, body }) => {
				await setRole(role);
				for (const organizationId of [orgId, undefined]) {
					const url =
						!body && organizationId
							? `${path}?organizationId=${organizationId}`
							: path;
					const response = await app.request(url, {
						method,
						headers: { Cookie: token, "Content-Type": "application/json" },
						body: body
							? JSON.stringify({ ...body, organizationId })
							: undefined,
					});
					expect(response.status).toBe(organizationId ? 403 : 404);
					expect(await response.json()).toMatchObject({
						message: organizationId
							? "Only organization owners and admins can access billing"
							: "Organization not found",
					});
				}
				expect(stripeMock.setupIntents.create).not.toHaveBeenCalled();
				expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
				expect(stripeMock.paymentMethods.retrieve).not.toHaveBeenCalled();
			},
		);

		test.each([
			"status",
			"create-pro-subscription",
			"cancel-pro-subscription",
			"resume-pro-subscription",
			"upgrade-to-yearly",
		])("cannot access subscription %s", async (path) => {
			await setRole(role);
			const response = await app.request(
				`/subscriptions/${path}?organizationId=${orgId}`,
				{
					method: path === "status" ? "GET" : "POST",
					headers: { Cookie: token, "Content-Type": "application/json" },
					body: path === "status" ? undefined : JSON.stringify({}),
				},
			);
			expect(response.status).toBe(403);
		});

		test.each([
			"transactions",
			"transactions/test-transaction/invoice",
			"credits-runway",
			"limits",
		])("cannot read %s", async (path) => {
			await setRole(role);
			const response = await app.request(`/orgs/${orgId}/${path}`, {
				headers: { Cookie: token },
			});
			expect(response.status).toBe(403);
		});

		test("cannot update billing settings", async () => {
			await setRole(role);
			const response = await app.request(`/orgs/${orgId}`, {
				method: "PATCH",
				headers: { Cookie: token, "Content-Type": "application/json" },
				body: JSON.stringify({
					billingEmail: "billing@example.com",
					autoTopUpEnabled: true,
				}),
			});
			expect(response.status).toBe(403);
		});
	});

	test.each(["developer", "project_admin"] as const)(
		"DevPass does not inherit billing details from a %s membership",
		async (role) => {
			await setRole(role);
			await db
				.update(tables.organization)
				.set({ billingCompany: "Team billing company" })
				.where(eq(tables.organization.id, orgId));
			await db.insert(tables.organization).values({
				id: "personal-org-id",
				name: "DevPass",
				kind: "devpass",
				billingEmail: "admin@example.com",
			});
			await db.insert(tables.userOrganization).values({
				userId: "test-user-id",
				organizationId: "personal-org-id",
				role: "owner",
			});
			const response = await app.request("/dev-plans/billing-details", {
				headers: { Cookie: token },
			});
			expect(response.status).toBe(200);
			const result = (await response.json()) as {
				own: Record<string, unknown>;
				default: Record<string, unknown>;
			};
			expect(result.default).toEqual(result.own);
			expect(result.default.billingCompany).toBeNull();
		},
	);

	test.each(["owner", "admin"] as const)(
		"%s can read billing and add a payment method",
		async (role) => {
			await setRole(role);
			for (const path of [
				"/payments/payment-methods",
				"/subscriptions/status",
			]) {
				const response = await app.request(`${path}?organizationId=${orgId}`, {
					headers: { Cookie: token },
				});
				expect(response.status).toBe(200);
			}
			const response = await app.request("/payments/create-setup-intent", {
				method: "POST",
				headers: { Cookie: token, "Content-Type": "application/json" },
				body: JSON.stringify({ organizationId: orgId }),
			});
			expect(response.status).toBe(200);
			expect(stripeMock.setupIntents.create).toHaveBeenCalledWith(
				expect.objectContaining({ customer: "cus_test_billing" }),
			);
		},
	);

	test.each(["owner", "admin"] as const)(
		"%s can initiate a credit top-up",
		async (role) => {
			await setRole(role);
			const response = await app.request("/payments/create-payment-intent", {
				method: "POST",
				headers: { Cookie: token, "Content-Type": "application/json" },
				body: JSON.stringify({ organizationId: orgId, amount: 10 }),
			});
			expect(response.status).toBe(200);
			expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
				expect.objectContaining({
					metadata: expect.objectContaining({ organizationId: orgId }),
				}),
			);
		},
	);

	describe.each(["developer", "project_admin"] as const)(
		"legacy requests with a %s membership",
		(memberRole) => {
			test.each(["owner", "admin"] as const)(
				"select the organization where the user is %s",
				async (adminRole) => {
					await setRole(memberRole);
					await db.insert(tables.organization).values({
						id: "admin-org-id",
						name: "Admin Organization",
						billingEmail: "admin@example.com",
						stripeCustomerId: "cus_test_admin",
					});
					await db.insert(tables.userOrganization).values({
						userId: "test-user-id",
						organizationId: "admin-org-id",
						role: adminRole,
					});
					for (const path of [
						"/payments/payment-methods",
						"/subscriptions/status",
					]) {
						const implicitResponse = await app.request(path, {
							headers: { Cookie: token },
						});
						expect(implicitResponse.status).toBe(200);
						const explicitResponse = await app.request(
							`${path}?organizationId=${orgId}`,
							{ headers: { Cookie: token } },
						);
						expect(explicitResponse.status).toBe(403);
					}
					const response = await app.request(
						"/payments/create-payment-intent",
						{
							method: "POST",
							headers: { Cookie: token, "Content-Type": "application/json" },
							body: JSON.stringify({ amount: 10 }),
						},
					);
					expect(response.status).toBe(200);
					expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
						expect.objectContaining({
							customer: "cus_test_admin",
							metadata: expect.objectContaining({
								organizationId: "admin-org-id",
							}),
						}),
					);
				},
			);
		},
	);

	test("legacy requests select the earliest active administrative membership", async () => {
		await db.insert(tables.organization).values([
			{
				id: "deleted-org-id",
				name: "Deleted Organization",
				billingEmail: "admin@example.com",
				status: "deleted",
			},
			{
				id: "older-org-id",
				name: "Older Organization",
				billingEmail: "admin@example.com",
				stripeCustomerId: "cus_test_older",
			},
		]);
		await db.insert(tables.userOrganization).values([
			{
				userId: "test-user-id",
				organizationId: "older-org-id",
				role: "admin",
				createdAt: new Date("2025-01-02"),
			},
			{
				userId: "test-user-id",
				organizationId: "deleted-org-id",
				role: "owner",
				createdAt: new Date("2025-01-01"),
			},
		]);
		const response = await app.request("/payments/create-setup-intent", {
			method: "POST",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(response.status).toBe(200);
		expect(stripeMock.setupIntents.create).toHaveBeenCalledWith(
			expect.objectContaining({ customer: "cus_test_older" }),
		);
		const deletedResponse = await app.request(
			"/payments/payment-methods?organizationId=deleted-org-id",
			{ headers: { Cookie: token } },
		);
		expect(deletedResponse.status).toBe(404);
	});

	test("billing access follows each organization's role and a subsequent demotion", async () => {
		await db.insert(tables.organization).values({
			id: "other-org-id",
			name: "Other Organization",
			billingEmail: "billing@example.com",
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: "other-org-id",
			role: "developer",
		});
		for (const path of ["/payments/payment-methods", "/subscriptions/status"]) {
			const response = await app.request(
				`${path}?organizationId=other-org-id`,
				{ headers: { Cookie: token } },
			);
			expect(response.status).toBe(403);
		}
		await setRole("developer");
		const response = await app.request(
			`/payments/payment-methods?organizationId=${orgId}`,
			{ headers: { Cookie: token } },
		);
		expect(response.status).toBe(403);
	});

	test("admins cannot manage another organization's billing", async () => {
		await db.insert(tables.organization).values({
			id: "other-org-id",
			name: "Other Organization",
			billingEmail: "billing@example.com",
		});
		const response = await app.request(
			"/payments/payment-methods?organizationId=other-org-id",
			{ headers: { Cookie: token } },
		);
		expect(response.status).toBe(404);
	});
});
