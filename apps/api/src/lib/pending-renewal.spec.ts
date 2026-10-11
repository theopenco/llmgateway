import { beforeEach, describe, expect, test, vi } from "vitest";

import {
	getPendingSubscriptionInvoices,
	voidOpenSubscriptionInvoices,
	voidPendingCycleRenewalInvoices,
} from "./pending-renewal.js";

import type * as PaymentsModule from "@/routes/payments.js";

const stripeMock = vi.hoisted(() => ({
	invoices: {
		list: vi.fn(),
		finalizeInvoice: vi.fn(),
		voidInvoice: vi.fn(),
	},
}));

vi.mock("@/routes/payments.js", async (importOriginal) => {
	const original = await importOriginal<typeof PaymentsModule>();
	return {
		...original,
		getStripe: () => stripeMock,
	};
});

const SUB_ID = "sub_test_pending_renewal";

function mockInvoiceLists(opts: {
	draft?: Record<string, unknown>[];
	open?: Record<string, unknown>[];
}) {
	stripeMock.invoices.list.mockImplementation(
		(params: { status: "draft" | "open" }) =>
			Promise.resolve({
				data: (params.status === "draft" ? opts.draft : opts.open) ?? [],
			}),
	);
}

describe("voidPendingCycleRenewalInvoices", () => {
	beforeEach(() => {
		stripeMock.invoices.list.mockReset();
		stripeMock.invoices.finalizeInvoice.mockReset();
		stripeMock.invoices.voidInvoice.mockReset();
	});

	test("finalizes without a payment attempt and voids a draft cycle-renewal invoice", async () => {
		mockInvoiceLists({
			draft: [
				{
					id: "in_draft_cycle",
					status: "draft",
					billing_reason: "subscription_cycle",
				},
			],
		});
		stripeMock.invoices.finalizeInvoice.mockResolvedValue({
			id: "in_draft_cycle",
			status: "open",
		});

		await voidPendingCycleRenewalInvoices(SUB_ID);

		expect(stripeMock.invoices.finalizeInvoice).toHaveBeenCalledWith(
			"in_draft_cycle",
			{ auto_advance: false },
		);
		expect(stripeMock.invoices.voidInvoice).toHaveBeenCalledWith(
			"in_draft_cycle",
		);
	});

	test("voids an already-finalized open cycle-renewal invoice directly", async () => {
		mockInvoiceLists({
			open: [
				{
					id: "in_open_cycle",
					status: "open",
					billing_reason: "subscription_cycle",
				},
			],
		});

		await voidPendingCycleRenewalInvoices(SUB_ID);

		expect(stripeMock.invoices.finalizeInvoice).not.toHaveBeenCalled();
		expect(stripeMock.invoices.voidInvoice).toHaveBeenCalledWith(
			"in_open_cycle",
		);
	});

	test("leaves non-cycle invoices (e.g. the upgrade's own invoice) untouched", async () => {
		mockInvoiceLists({
			draft: [
				{
					id: "in_manual",
					status: "draft",
					billing_reason: "manual",
				},
			],
			open: [
				{
					id: "in_upgrade",
					status: "open",
					billing_reason: "subscription_update",
				},
			],
		});

		await voidPendingCycleRenewalInvoices(SUB_ID);

		expect(stripeMock.invoices.finalizeInvoice).not.toHaveBeenCalled();
		expect(stripeMock.invoices.voidInvoice).not.toHaveBeenCalled();
	});

	test("does not void a draft that comes back from finalization already paid", async () => {
		// Race: the invoice finalized and collected between our list and
		// finalize calls. Nothing left to void; the webhook staleness guard
		// handles the charge.
		mockInvoiceLists({
			draft: [
				{
					id: "in_draft_raced",
					status: "draft",
					billing_reason: "subscription_cycle",
				},
			],
		});
		stripeMock.invoices.finalizeInvoice.mockResolvedValue({
			id: "in_draft_raced",
			status: "paid",
		});

		await voidPendingCycleRenewalInvoices(SUB_ID);

		expect(stripeMock.invoices.voidInvoice).not.toHaveBeenCalled();
	});

	test("swallows Stripe errors so the upgrade is never blocked", async () => {
		stripeMock.invoices.list.mockRejectedValue(new Error("stripe down"));

		await expect(
			voidPendingCycleRenewalInvoices(SUB_ID),
		).resolves.toBeUndefined();

		mockInvoiceLists({
			open: [
				{
					id: "in_open_err",
					status: "open",
					billing_reason: "subscription_cycle",
				},
			],
		});
		stripeMock.invoices.voidInvoice.mockRejectedValue(
			new Error("already paid"),
		);

		await expect(
			voidPendingCycleRenewalInvoices(SUB_ID),
		).resolves.toBeUndefined();
	});

	test.each(["draft", "open"] as const)(
		"voids invoices from every %s page, including non-renewals on cancellation",
		async (status) => {
			stripeMock.invoices.list.mockImplementation(
				async (params: { status: string; starting_after?: string }) => {
					if (params.status !== status) {
						return { data: [], has_more: false };
					}
					return {
						data: [
							{
								id: params.starting_after ? "in_last" : "in_first",
								status,
								billing_reason: "manual",
							},
						],
						has_more: !params.starting_after,
					};
				},
			);
			stripeMock.invoices.finalizeInvoice.mockResolvedValue({ status: "open" });
			await voidOpenSubscriptionInvoices(SUB_ID);
			expect(stripeMock.invoices.list).toHaveBeenCalledWith({
				subscription: SUB_ID,
				status,
				limit: 100,
				starting_after: "in_first",
			});
			expect(stripeMock.invoices.voidInvoice).toHaveBeenCalledWith("in_first");
			expect(stripeMock.invoices.voidInvoice).toHaveBeenCalledWith("in_last");
		},
	);

	test("rejects an empty page that claims more invoices instead of looping", async () => {
		stripeMock.invoices.list.mockResolvedValue({ data: [], has_more: true });
		await expect(getPendingSubscriptionInvoices(SUB_ID)).rejects.toThrow(
			"pagination did not advance",
		);
	});
});
