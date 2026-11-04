import { describe, expect, it } from "vitest";

import {
	centsToDollars,
	DEV_PLAN_TX_TYPES,
	planRefundAnchors,
	refundDescription,
	REFUNDABLE_ORIGINAL_TYPES,
	type TransactionRow, parseBackfillArgs } from "./devpass-refund-backfill.js";

function original(
	id: string,
	overrides: Partial<TransactionRow> = {},
): TransactionRow {
	return {
		id,
		organizationId: `org-${id}`,
		type: "dev_plan_renewal",
		amount: "29.00",
		createdAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	} as TransactionRow;
}

describe("centsToDollars", () => {
	it("keeps cent precision exactly", () => {
		expect(centsToDollars(2900).toFixed(2)).toBe("29.00");
		expect(centsToDollars(1455).toFixed(2)).toBe("14.55");
		expect(centsToDollars(1).toFixed(2)).toBe("0.01");
	});

	it("sums without float drift", () => {
		const total = [1010, 2020, 3030].reduce(
			(sum, cents) => sum.plus(centsToDollars(cents)),
			centsToDollars(0),
		);
		expect(total.toFixed(2)).toBe("60.60");
	});
});

describe("refundDescription", () => {
	it("reports the refunded share of the original", () => {
		expect(centsToDollars(1450)).toBeDefined();
		expect(refundDescription(centsToDollars(1450), centsToDollars(2900))).toBe(
			"Credit refund: $14.50 (50.0% of original purchase) [backfilled]",
		);
	});

	it("does not divide by a zero original", () => {
		expect(refundDescription(centsToDollars(500), centsToDollars(0))).toContain(
			"(0.0% of original purchase)",
		);
	});
});

describe("refundable original types", () => {
	// handleChargeRefunded (apps/api/src/stripe.ts) records a credit_refund for
	// Reset Pass purchases, so the backfill must be able to discover them too.
	it("covers Reset Pass purchases", () => {
		expect(REFUNDABLE_ORIGINAL_TYPES).toContain("dev_plan_reset_pass");
		expect(DEV_PLAN_TX_TYPES).toContain("dev_plan_reset_pass");
	});

	it("excludes lifecycle marker rows that never took money", () => {
		for (const type of ["dev_plan_cancel", "dev_plan_end", "dev_plan_resume"]) {
			expect(REFUNDABLE_ORIGINAL_TYPES).not.toContain(type);
		}
	});
});

describe("planRefundAnchors", () => {
	it("anchors each payment intent on its earliest original", () => {
		const start = original("start", {
			createdAt: new Date("2026-01-01T00:00:00Z"),
		});
		const renewal = original("renewal", {
			createdAt: new Date("2026-02-01T00:00:00Z"),
		});
		const { anchorByPaymentIntent } = planRefundAnchors({
			originals: [renewal, start],
			paymentIntentsByOriginalId: new Map([
				["start", ["pi_1"]],
				["renewal", ["pi_1"]],
			]),
			legacyPaymentIntentIds: new Set(),
			legacyOriginalIds: new Set(),
		});
		expect(anchorByPaymentIntent.get("pi_1")?.id).toBe("start");
	});

	it("withholds a payment intent that still has an unreconciled legacy row", () => {
		const row = original("renewal");
		const { anchorByPaymentIntent, legacyBlockedPaymentIntentIds } =
			planRefundAnchors({
				originals: [row],
				paymentIntentsByOriginalId: new Map([["renewal", ["pi_1"]]]),
				legacyPaymentIntentIds: new Set(["pi_1"]),
				legacyOriginalIds: new Set(),
			});
		expect(anchorByPaymentIntent.size).toBe(0);
		expect([...legacyBlockedPaymentIntentIds]).toEqual(["pi_1"]);
	});

	it("withholds a payment intent whose original has an unreconciled legacy row", () => {
		const row = original("renewal");
		const { anchorByPaymentIntent, legacyBlockedPaymentIntentIds } =
			planRefundAnchors({
				originals: [row],
				paymentIntentsByOriginalId: new Map([["renewal", ["pi_1"]]]),
				legacyPaymentIntentIds: new Set(),
				legacyOriginalIds: new Set(["renewal"]),
			});
		expect(anchorByPaymentIntent.size).toBe(0);
		expect([...legacyBlockedPaymentIntentIds]).toEqual(["pi_1"]);
	});

	it("withholds a shared payment intent even when another original is clean", () => {
		// The legacy row hangs off the start row, but both originals settled the
		// same payment intent — inserting via the clean one would double-count.
		const start = original("start", {
			createdAt: new Date("2026-01-01T00:00:00Z"),
		});
		const renewal = original("renewal", {
			createdAt: new Date("2026-02-01T00:00:00Z"),
		});
		const { anchorByPaymentIntent } = planRefundAnchors({
			originals: [renewal, start],
			paymentIntentsByOriginalId: new Map([
				["start", ["pi_1"]],
				["renewal", ["pi_1"]],
			]),
			legacyPaymentIntentIds: new Set(),
			legacyOriginalIds: new Set(["start"]),
		});
		expect(anchorByPaymentIntent.has("pi_1")).toBe(false);
	});

	it("keeps only the scoped payment intent", () => {
		const row = original("renewal");
		const { anchorByPaymentIntent } = planRefundAnchors({
			originals: [row],
			paymentIntentsByOriginalId: new Map([["renewal", ["pi_1", "pi_2"]]]),
			legacyPaymentIntentIds: new Set(),
			legacyOriginalIds: new Set(),
			scopePI: "pi_2",
		});
		expect([...anchorByPaymentIntent.keys()]).toEqual(["pi_2"]);
	});

	it("skips originals with no resolved payment intent", () => {
		const { anchorByPaymentIntent } = planRefundAnchors({
			originals: [original("renewal")],
			paymentIntentsByOriginalId: new Map(),
			legacyPaymentIntentIds: new Set(),
			legacyOriginalIds: new Set(),
		});
		expect(anchorByPaymentIntent.size).toBe(0);
	});
});

describe("strict backfill arguments", () => {
	it("defaults to dry-run and preserves explicit scopes", () => {
		expect(parseBackfillArgs([])).toEqual({ commit: false });
		expect(parseBackfillArgs(["--commit", "--org=fixture-org", "--payment-intent=pi_fixture"])).toEqual({ commit: true, org: "fixture-org", "payment-intent": "pi_fixture" });
	});
	it.each([["--commmit"], ["--commit", "--org="], ["--org"], ["--org=a", "--org=b"], ["--payment-intent="], ["--commit=true"], ["unexpected"], ["--org=   "], ["--commit", "--commit"]].map((args) => ({ args })))("rejects $args", ({ args }) => {
		expect(() => parseBackfillArgs(args)).toThrow();
	});
});

