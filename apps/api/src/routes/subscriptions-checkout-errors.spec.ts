import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type MockInstance,
} from "vitest";

import { app } from "@/index.js";
import { PRICING_NOT_CONFIGURED_MESSAGE } from "@/lib/required-price-id.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

const stripeMock = vi.hoisted(() => ({
	checkout: {
		sessions: {
			create: vi.fn(),
		},
	},
	customers: {
		retrieve: vi.fn(),
		update: vi.fn(),
	},
	subscriptions: {
		retrieve: vi.fn(),
	},
}));

vi.mock("stripe", () => ({
	default: function MockStripe() {
		return stripeMock;
	},
}));

process.env.STRIPE_SECRET_KEY ??= "sk_test_mock";

const STRIPE_ERROR_TEXT = "No such price: 'price_secret_internal'";

let token: string;
let logError: MockInstance<typeof logger.error>;

beforeEach(async () => {
	vi.clearAllMocks();
	logError = vi.spyOn(logger, "error").mockImplementation(() => undefined);
	stripeMock.customers.retrieve.mockResolvedValue({
		id: "cus_checkout_errors",
		deleted: false,
	});
	stripeMock.customers.update.mockResolvedValue({ id: "cus_checkout_errors" });
	token = await createTestUser();
});

afterEach(async () => {
	logError.mockRestore();
	vi.unstubAllEnvs();
	await deleteAll();
});

type OrgValues = Omit<
	typeof tables.organization.$inferInsert,
	"name" | "billingEmail"
> & { id: string };

async function insertOrg(values: OrgValues) {
	await db.insert(tables.organization).values({
		name: "Test Organization",
		billingEmail: "admin@example.com",
		stripeCustomerId: "cus_checkout_errors",
		...values,
	});
	await db.insert(tables.userOrganization).values({
		userId: "test-user-id",
		organizationId: values.id,
		role: "owner",
	});
}

function post(path: string, body: unknown) {
	return app.request(path, {
		method: "POST",
		headers: {
			Cookie: token,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

// Route-level log messages; the global onError handler also logs every 5xx
// HTTPException with its client-safe message.
function routeLogMessages(): string[] {
	return logError.mock.calls
		.map(([message]) => message)
		.filter((message) => message !== "HTTPException");
}

async function expectPricingNotConfigured(res: Response, envKey: string) {
	expect(res.status).toBe(500);
	const body = await res.json();
	expect(body.message).toBe(PRICING_NOT_CONFIGURED_MESSAGE);
	expect(body.message).not.toContain(envKey);
	expect(routeLogMessages()).toEqual([
		`${envKey} environment variable is not set`,
	]);
}

async function expectGenericCheckoutFailure(res: Response) {
	expect(res.status).toBe(500);
	const body = await res.json();
	expect(body.message).toBe("Failed to create checkout session");
	expect(body.message).not.toContain(STRIPE_ERROR_TEXT);
	expect(routeLogMessages()).toHaveLength(1);
	expect(routeLogMessages()[0]).toMatch(/checkout session error/);
}

describe("POST /subscriptions/create-pro-subscription error messages", () => {
	const ORG_ID = "test-pro-checkout-errors-org";

	beforeEach(async () => {
		vi.stubEnv("STRIPE_PRO_MONTHLY_PRICE_ID", "price_pro_monthly");
		await insertOrg({ id: ORG_ID });
	});

	function createCheckout() {
		return post(
			`/subscriptions/create-pro-subscription?organizationId=${ORG_ID}`,
			{ billingCycle: "monthly" },
		);
	}

	it("does not return the Stripe error text to the client", async () => {
		stripeMock.checkout.sessions.create.mockRejectedValue(
			new Error(STRIPE_ERROR_TEXT),
		);

		await expectGenericCheckoutFailure(await createCheckout());
	});

	it("returns the pricing message without the env var name", async () => {
		vi.stubEnv("STRIPE_PRO_MONTHLY_PRICE_ID", undefined);

		await expectPricingNotConfigured(
			await createCheckout(),
			"STRIPE_PRO_MONTHLY_PRICE_ID",
		);
		expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
	});

	it("returns the missing checkout URL message unchanged", async () => {
		stripeMock.checkout.sessions.create.mockResolvedValue({ url: null });

		const res = await createCheckout();

		expect(res.status).toBe(500);
		expect((await res.json()).message).toBe("Failed to generate checkout URL");
	});
});

describe("dev plan checkout and tier change error messages", () => {
	const ORG_ID = "test-dev-plan-checkout-errors-org";

	beforeEach(() => {
		vi.stubEnv("STRIPE_DEV_PLAN_PRO_PRICE_ID", "price_dev_pro");
	});

	it("subscribe: hides the missing env var name", async () => {
		await insertOrg({ id: ORG_ID, kind: "devpass" });
		vi.stubEnv("STRIPE_DEV_PLAN_PRO_PRICE_ID", undefined);

		await expectPricingNotConfigured(
			await post("/dev-plans/subscribe", { tier: "pro" }),
			"STRIPE_DEV_PLAN_PRO_PRICE_ID",
		);
		expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
	});

	it("subscribe: hides the raw Stripe error", async () => {
		await insertOrg({ id: ORG_ID, kind: "devpass" });
		stripeMock.checkout.sessions.create.mockRejectedValue(
			new Error(STRIPE_ERROR_TEXT),
		);

		await expectGenericCheckoutFailure(
			await post("/dev-plans/subscribe", { tier: "pro" }),
		);
	});

	it("subscribe: returns the missing checkout URL message unchanged", async () => {
		await insertOrg({ id: ORG_ID, kind: "devpass" });
		stripeMock.checkout.sessions.create.mockResolvedValue({ url: null });

		const res = await post("/dev-plans/subscribe", { tier: "pro" });

		expect(res.status).toBe(500);
		expect((await res.json()).message).toBe("Failed to generate checkout URL");
	});

	describe("with an active lite plan", () => {
		beforeEach(async () => {
			await insertOrg({
				id: ORG_ID,
				kind: "devpass",
				devPlan: "lite",
				devPlanStripeSubscriptionId: "sub_dev_checkout_errors",
			});
			const now = Math.floor(Date.now() / 1000);
			stripeMock.subscriptions.retrieve.mockResolvedValue({
				id: "sub_dev_checkout_errors",
				status: "active",
				items: {
					data: [
						{
							id: "si_dev_checkout_errors",
							current_period_start: now - 500,
							current_period_end: now + 500,
						},
					],
				},
			});
			vi.stubEnv("STRIPE_DEV_PLAN_PRO_PRICE_ID", undefined);
		});

		it("change-tier-preview: hides the missing env var name", async () => {
			await expectPricingNotConfigured(
				await post("/dev-plans/change-tier-preview", { newTier: "pro" }),
				"STRIPE_DEV_PLAN_PRO_PRICE_ID",
			);
		});

		it("change-tier: hides the missing env var name", async () => {
			await expectPricingNotConfigured(
				await post("/dev-plans/change-tier", { newTier: "pro" }),
				"STRIPE_DEV_PLAN_PRO_PRICE_ID",
			);
		});
	});

	it("cancel-downgrade: hides the missing env var name", async () => {
		await insertOrg({
			id: ORG_ID,
			kind: "devpass",
			devPlan: "pro",
			devPlanPendingTier: "lite",
			devPlanStripeSubscriptionId: "sub_dev_checkout_errors",
		});
		vi.stubEnv("STRIPE_DEV_PLAN_PRO_PRICE_ID", undefined);

		await expectPricingNotConfigured(
			await post("/dev-plans/cancel-downgrade", {}),
			"STRIPE_DEV_PLAN_PRO_PRICE_ID",
		);
		expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
	});
});

describe("chat plan checkout and tier change error messages", () => {
	const ORG_ID = "test-chat-plan-checkout-errors-org";

	it("subscribe: hides the missing env var name", async () => {
		await insertOrg({ id: ORG_ID, kind: "chat" });
		vi.stubEnv("STRIPE_CHAT_PLAN_PLUS_PRICE_ID", undefined);

		await expectPricingNotConfigured(
			await post("/chat-plans/subscribe", { tier: "plus" }),
			"STRIPE_CHAT_PLAN_PLUS_PRICE_ID",
		);
		expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
	});

	it("change-tier: hides the missing env var name", async () => {
		await insertOrg({
			id: ORG_ID,
			kind: "chat",
			chatPlan: "starter",
			chatPlanStripeSubscriptionId: "sub_chat_checkout_errors",
		});
		vi.stubEnv("STRIPE_CHAT_PLAN_PLUS_PRICE_ID", undefined);

		await expectPricingNotConfigured(
			await post("/chat-plans/change-tier", { newTier: "plus" }),
			"STRIPE_CHAT_PLAN_PLUS_PRICE_ID",
		);
		expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
	});
});
