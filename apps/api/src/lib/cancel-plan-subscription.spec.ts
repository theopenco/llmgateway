import { beforeEach, describe, expect, it, vi } from "vitest";

import { cancelPlanSubscription } from "./cancel-plan-subscription.js";

const stripe = vi.hoisted(() => ({
	subscriptions: { retrieve: vi.fn(), update: vi.fn(), cancel: vi.fn() },
	invoices: { list: vi.fn(), finalizeInvoice: vi.fn(), voidInvoice: vi.fn() },
}));

vi.mock("@/routes/payments.js", () => ({ getStripe: () => stripe }));

const subscriptionId = "sub_test_cancellation";

describe("cancelPlanSubscription", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		stripe.subscriptions.retrieve.mockResolvedValue({ status: "active" });
		stripe.subscriptions.update.mockResolvedValue({ status: "active" });
		stripe.invoices.list.mockResolvedValue({ data: [], has_more: false });
	});

	it.each(["active", "trialing"])(
		"preserves the period for %s subscriptions without a renewal",
		async (status) => {
			stripe.subscriptions.retrieve.mockResolvedValue({ status });
			stripe.subscriptions.update.mockResolvedValue({ status });
			expect(await cancelPlanSubscription(subscriptionId)).toEqual({
				immediate: false,
			});
			expect(stripe.subscriptions.update).toHaveBeenCalledWith(subscriptionId, {
				cancel_at_period_end: true,
			});
			expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
		},
	);

	it.each(["past_due", "unpaid", "incomplete", "paused"])(
		"ends %s subscriptions without scheduling another period",
		async (status) => {
			stripe.subscriptions.retrieve.mockResolvedValue({ status });
			expect(await cancelPlanSubscription(subscriptionId)).toEqual({
				immediate: true,
			});
			expect(stripe.subscriptions.update).not.toHaveBeenCalled();
			expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(subscriptionId, {
				invoice_now: false,
				prorate: false,
			});
		},
	);

	it.each(["canceled", "incomplete_expired"])(
		"cleans invoices without modifying a %s subscription",
		async (status) => {
			stripe.subscriptions.retrieve.mockResolvedValue({ status });
			expect(await cancelPlanSubscription(subscriptionId)).toEqual({
				immediate: true,
			});
			expect(stripe.subscriptions.update).not.toHaveBeenCalled();
			expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
			expect(stripe.invoices.list).toHaveBeenCalled();
		},
	);

	it.each(["draft", "open"])(
		"catches a %s renewal created while scheduling cancellation",
		async (status) => {
			stripe.subscriptions.update.mockImplementation(async () => {
				stripe.invoices.list.mockImplementation(
					async (params: { status: string }) => ({
						data:
							params.status === status
								? [
										{
											id: "in_renewal",
											status,
											billing_reason: "subscription_cycle",
										},
									]
								: [],
						has_more: false,
					}),
				);
				return { status: "active" };
			});
			stripe.invoices.finalizeInvoice.mockResolvedValue({
				id: "in_renewal",
				status: "open",
			});
			expect(await cancelPlanSubscription(subscriptionId)).toEqual({
				immediate: true,
			});
			expect(stripe.subscriptions.cancel).toHaveBeenCalled();
			expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith("in_renewal");
		},
	);

	it("uses the overdue status returned by the scheduling update", async () => {
		stripe.subscriptions.update.mockResolvedValue({ status: "past_due" });
		expect(await cancelPlanSubscription(subscriptionId)).toEqual({
			immediate: true,
		});
		expect(stripe.subscriptions.cancel).toHaveBeenCalled();
	});

	it("does not end a paid plan for an unrelated invoice", async () => {
		stripe.invoices.list.mockResolvedValue({
			data: [{ id: "in_manual", status: "open", billing_reason: "manual" }],
		});
		expect(await cancelPlanSubscription(subscriptionId)).toEqual({
			immediate: false,
		});
		expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled();
	});

	it("still ends the subscription when invoice discovery fails", async () => {
		stripe.invoices.list.mockRejectedValue(
			new Error("invoice lookup unavailable"),
		);
		expect(await cancelPlanSubscription(subscriptionId)).toEqual({
			immediate: true,
		});
		expect(stripe.subscriptions.cancel).toHaveBeenCalled();
	});

	it("does not report success or void invoices when cancellation fails", async () => {
		stripe.subscriptions.retrieve.mockResolvedValue({ status: "past_due" });
		stripe.subscriptions.cancel.mockRejectedValue(
			new Error("cancellation unavailable"),
		);
		await expect(cancelPlanSubscription(subscriptionId)).rejects.toThrow(
			"cancellation unavailable",
		);
		expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled();
	});
});
