import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";
import { paidTransactionTypes } from "@/utils/devpass-filter.js";

import { db, tables } from "@llmgateway/db";

const allTransactionTypes = tables.transaction.type.enumValues;
const nonPaidTransactionTypes = allTransactionTypes.filter(
	(t) => !(paidTransactionTypes as readonly string[]).includes(t),
);

interface AdminMetricsResponse {
	payingCustomers: number;
}

interface TimeseriesPoint {
	date: string;
	paidCustomers: number;
	net: number;
	devpassRevenue: number;
	devpassRefunds: number;
	devpassNet: number;
	dailySignups: number;
	dailyPaidCustomers: number;
	dailyNet: number;
	dailyDevpassNet: number;
}

interface TimeseriesResponse {
	data: TimeseriesPoint[];
	totals: {
		paidCustomers: number;
		net: number;
		devpassRevenue: number;
		devpassRefunds: number;
		devpassNet: number;
	};
}

async function getMetrics(cookie: string): Promise<AdminMetricsResponse> {
	const res = await app.request("/admin/metrics", {
		headers: { Cookie: cookie },
	});
	expect(res.status).toBe(200);
	return (await res.json()) as AdminMetricsResponse;
}

async function getTimeseries(
	cookie: string,
	query = "",
): Promise<TimeseriesResponse> {
	const res = await app.request(`/admin/metrics/timeseries${query}`, {
		headers: { Cookie: cookie },
	});
	expect(res.status).toBe(200);
	return (await res.json()) as TimeseriesResponse;
}

describe("admin paid customers — transaction type matrix", () => {
	let cookie: string;

	// One org per paid transaction type, all of them counting exactly once,
	// plus orgs that must never count: one holding every non-paid type, one
	// with only a pending payment, and one with multiple paid transactions
	// (must not be double-counted).
	const expectedPaidCustomers = paidTransactionTypes.length + 1;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values([
			...paidTransactionTypes.map((type) => ({
				id: `paid-${type}`,
				name: `Paid ${type}`,
				billingEmail: `${type}@example.com`,
			})),
			{
				id: "non-paid-org",
				name: "Non Paid Org",
				billingEmail: "non-paid@example.com",
			},
			{
				id: "pending-org",
				name: "Pending Org",
				billingEmail: "pending@example.com",
			},
			{
				id: "multi-paid-org",
				name: "Multi Paid Org",
				billingEmail: "multi@example.com",
			},
		]);

		await db.insert(tables.transaction).values([
			// Each paid type on its own org — every one must count as a paid
			// customer exactly once.
			...paidTransactionTypes.map((type) => ({
				organizationId: `paid-${type}`,
				type,
				amount: "10",
				creditAmount: "10",
				status: "completed" as const,
			})),
			// Every remaining enum value on a single org — none of these
			// (gifts, refunds, cancel/end/downgrade bookkeeping, end-user margin
			// rows) may qualify it as paying.
			...nonPaidTransactionTypes.map((type) => ({
				organizationId: "non-paid-org",
				type,
				amount: "10",
				creditAmount: "10",
				status: "completed" as const,
			})),
			// A real payment type that never completed must not count.
			{
				organizationId: "pending-org",
				type: "credit_topup" as const,
				amount: "10",
				creditAmount: "10",
				status: "pending" as const,
			},
			// Multiple paid transactions on one org count as one customer.
			{
				organizationId: "multi-paid-org",
				type: "credit_topup" as const,
				amount: "10",
				creditAmount: "10",
				status: "completed" as const,
			},
			{
				organizationId: "multi-paid-org",
				type: "dev_plan_renewal" as const,
				amount: "10",
				creditAmount: "10",
				status: "completed" as const,
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("every transaction type is classified as paid or non-paid", () => {
		for (const type of paidTransactionTypes) {
			expect(allTransactionTypes).toContain(type);
		}
		expect(paidTransactionTypes.length + nonPaidTransactionTypes.length).toBe(
			allTransactionTypes.length,
		);
	});

	test("/admin/metrics payingCustomers counts only orgs with completed payments", async () => {
		const body = await getMetrics(cookie);
		expect(body.payingCustomers).toBe(expectedPaidCustomers);
	});

	test("/admin/metrics/timeseries paid customer totals add up", async () => {
		const body = await getTimeseries(cookie);

		expect(body.totals.paidCustomers).toBe(expectedPaidCustomers);
		// The cumulative series must end at the total, and the per-day new paid
		// customers must sum to it (nothing counted twice, nothing pre-range).
		expect(body.data.at(-1)?.paidCustomers).toBe(expectedPaidCustomers);
		const dailySum = body.data.reduce(
			(sum, point) => sum + point.dailyPaidCustomers,
			0,
		);
		expect(dailySum).toBe(expectedPaidCustomers);
	});
});

describe("admin paid customers — bounded range baseline", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values([
			{
				id: "old-org",
				name: "Old Org",
				billingEmail: "old@example.com",
			},
			{
				id: "recent-org",
				name: "Recent Org",
				billingEmail: "recent@example.com",
			},
			{
				id: "gift-org",
				name: "Gift Org",
				billingEmail: "gift@example.com",
			},
		]);

		// eslint-disable-next-line no-mixed-operators
		const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
		await db.insert(tables.transaction).values([
			// First payment well before the 7d range — belongs to the baseline.
			{
				organizationId: "old-org",
				type: "credit_topup",
				amount: "21",
				creditAmount: "20",
				status: "completed",
				createdAt: sixtyDaysAgo,
			},
			// Second payment inside the range — must not re-count the org.
			{
				organizationId: "old-org",
				type: "credit_topup",
				amount: "6",
				creditAmount: "5",
				status: "completed",
			},
			// First payment inside the range — the only new paid customer.
			{
				organizationId: "recent-org",
				type: "credit_topup",
				amount: "11",
				creditAmount: "10",
				status: "completed",
			},
			// Gift inside the range — no paid customer, no revenue.
			{
				organizationId: "gift-org",
				type: "credit_gift",
				amount: "3",
				creditAmount: "3",
				status: "completed",
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("range=7d keeps pre-range customers in the baseline, not in day one", async () => {
		const body = await getTimeseries(cookie, "?range=7d");
		const todayStr = new Date().toISOString().split("T")[0];
		const first = body.data[0];
		const today = body.data.find((point) => point.date === todayStr);

		// Both orgs are paid customers overall.
		expect(body.totals.paidCustomers).toBe(2);
		expect(body.data.at(-1)?.paidCustomers).toBe(2);

		// The old org sits in the cumulative baseline of the first point but
		// must not appear as a day-one delta (regression: the first sparkline
		// bar used to show the whole pre-range total).
		expect(first.paidCustomers).toBe(1);
		expect(first.dailyPaidCustomers).toBe(0);
		expect(first.dailySignups).toBe(0);
		expect(first.dailyNet).toBe(0);
		// Cumulative revenue also starts from the pre-range baseline.
		expect(first.net).toBe(20);

		// Only the recent org is a new paid customer within the range; the old
		// org's in-range second payment must not re-count it.
		const dailySum = body.data.reduce(
			(sum, point) => sum + point.dailyPaidCustomers,
			0,
		);
		expect(dailySum).toBe(1);
		expect(today?.dailyPaidCustomers).toBe(1);

		// Today's daily net = in-range payments (5 + 10); the gift is excluded.
		expect(today?.dailyNet).toBe(15);
		expect(body.totals.net).toBe(35);
	});
});

describe("admin timeseries — devpass revenue series", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values([
			{
				id: "devpass-org",
				name: "DevPass Org",
				billingEmail: "devpass@example.com",
				kind: "devpass",
			},
			{
				id: "pro-org",
				name: "Pro Org",
				billingEmail: "pro@example.com",
			},
		]);

		// eslint-disable-next-line no-mixed-operators
		const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
		await db.insert(tables.transaction).values([
			// Pre-range dev plan payment — belongs to the cumulative baseline.
			{
				organizationId: "devpass-org",
				type: "dev_plan_start",
				amount: "20",
				creditAmount: "40",
				status: "completed",
				stripeInvoiceId: "inv_pre",
				createdAt: sixtyDaysAgo,
			},
			// In-range dev plan payment.
			{
				id: "devpass-start-tx",
				organizationId: "devpass-org",
				type: "dev_plan_start",
				amount: "10",
				creditAmount: "20",
				status: "completed",
				stripeInvoiceId: "inv_1",
			},
			// In-range refund against a dev plan payment — netted out.
			{
				organizationId: "devpass-org",
				type: "credit_refund",
				amount: "4",
				creditAmount: "0",
				status: "completed",
				relatedTransactionId: "devpass-start-tx",
			},
			// Legacy `subscription_*` row on a NON-devpass org is org Pro revenue,
			// never DevPass revenue.
			{
				organizationId: "pro-org",
				type: "subscription_start",
				amount: "99",
				creditAmount: "0",
				status: "completed",
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("range=7d devpass series nets refunds and keeps baseline", async () => {
		const body = await getTimeseries(cookie, "?range=7d");
		const todayStr = new Date().toISOString().split("T")[0];
		const first = body.data[0];
		const today = body.data.find((point) => point.date === todayStr);

		// 20 pre-range + 10 in-range (org Pro subscription excluded).
		expect(body.totals.devpassRevenue).toBe(30);
		expect(body.totals.devpassRefunds).toBe(4);
		expect(body.totals.devpassNet).toBe(26);
		expect(body.data.at(-1)?.devpassNet).toBe(26);

		// Pre-range payment sits in the cumulative baseline, not in day one.
		expect(first.devpassNet).toBe(20);
		expect(first.dailyDevpassNet).toBe(0);

		// Today's delta: 10 gross - 4 refund.
		expect(today?.dailyDevpassNet).toBe(6);
	});
});
