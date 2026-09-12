import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "admin-devpass-margin-org";
const PROJECT_ID = "admin-devpass-margin-project";
const OTHER_ORG_ID = "admin-devpass-margin-default-org";
const OTHER_PROJECT_ID = "admin-devpass-margin-default-project";
const originalAdminEmails = process.env.ADMIN_EMAILS;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

interface KpisResponse {
	planMargin: number;
	totalMargin: number;
	marginPct: number | null;
	gatewayMarginCycle: number;
	resetPassesSold: number;
	resetPassRevenue: number;
	resetPassesSoldCycle: number;
	resetPassRevenueCycle: number;
	paygFeeCycle: number;
	paygFeeAllTime: number;
	totalRealCostCycle: number;
	totalOverflowCostCycle: number;
}

interface TimeseriesResponse {
	data: Array<{ date: string; gatewayMargin: number; margin: number }>;
	totals: {
		revenue: number;
		topupRevenue: number;
		cost: number;
		gatewayMargin: number;
		margin: number;
	};
}

interface UsageResponse {
	models: Array<{ id: string; cost: number }>;
	range: { from: string; to: string } | null;
}

function isoDay(date: Date) {
	return date.toISOString().slice(0, 10);
}

function daysAgo(now: Date, days: number) {
	const offset = days * DAY_MS;
	return new Date(now.getTime() - offset);
}

describe("admin devpass margin components", () => {
	let cookie: string;
	const now = new Date();
	const cycleStart = daysAgo(now, 5);
	const inCycle = new Date(cycleStart.getTime() + HOUR_MS);
	const beforeCycle = daysAgo(now, 10);

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values([
			{
				id: ORG_ID,
				name: "Margin Org",
				billingEmail: "margin@example.com",
				kind: "devpass",
				devPlan: "pro",
				devPlanCreditsUsed: "100",
				devPlanCreditsLimit: "237",
				devPlanBillingCycleStart: cycleStart,
			},
			{
				id: OTHER_ORG_ID,
				name: "Default Org",
				billingEmail: "default@example.com",
				kind: "default",
			},
		]);
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
		await db.insert(tables.project).values([
			{
				id: PROJECT_ID,
				name: "Margin Project",
				organizationId: ORG_ID,
				mode: "credits",
			},
			{
				id: OTHER_PROJECT_ID,
				name: "Default Project",
				organizationId: OTHER_ORG_ID,
				mode: "credits",
			},
		]);
		// $100 of credits-mode cost this cycle, all drawn from the plan pool.
		await db.insert(tables.projectHourlyStats).values({
			projectId: PROJECT_ID,
			hourTimestamp: inCycle,
			requestCount: 10,
			creditsCost: 100,
		});
		await db.insert(tables.projectHourlyModelStats).values([
			// Airside-carrier traffic inside the cycle: $40 at a 30% margin.
			{
				projectId: PROJECT_ID,
				hourTimestamp: inCycle,
				usedModel: "carrier-model",
				usedProvider: "carrier",
				requestCount: 4,
				cost: 40,
				creditsCost: 40,
				providerMarginAmount: 12,
			},
			// Before the cycle started: all-time only.
			{
				projectId: PROJECT_ID,
				hourTimestamp: beforeCycle,
				usedModel: "older-model",
				usedProvider: "carrier",
				requestCount: 2,
				cost: 20,
				creditsCost: 20,
				providerMarginAmount: 5,
			},
			// Traffic from a non-DevPass org never counts.
			{
				projectId: OTHER_PROJECT_ID,
				hourTimestamp: inCycle,
				usedModel: "carrier-model",
				usedProvider: "carrier",
				requestCount: 9,
				cost: 900,
				creditsCost: 900,
				providerMarginAmount: 100,
			},
		]);
		const inserted = await db
			.insert(tables.transaction)
			.values([
				{
					organizationId: ORG_ID,
					type: "dev_plan_start",
					amount: "79",
					creditAmount: "237",
					status: "completed",
					stripeInvoiceId: "inv_margin_start",
					createdAt: cycleStart,
				},
				// One Reset Pass inside the cycle, one before it.
				{
					organizationId: ORG_ID,
					type: "dev_plan_reset_pass",
					amount: "29",
					status: "completed",
					createdAt: daysAgo(now, 3),
				},
				{
					organizationId: ORG_ID,
					type: "dev_plan_reset_pass",
					amount: "29",
					status: "completed",
					createdAt: beforeCycle,
				},
				// PAYG overflow top-up: $26.25 charged for $25 of credits.
				{
					organizationId: ORG_ID,
					type: "credit_topup",
					amount: "26.25",
					creditAmount: "25",
					status: "completed",
					createdAt: daysAgo(now, 2),
				},
			])
			.returning();
		const topup = inserted.find((t) => t.type === "credit_topup")!;
		// Partial refund of the top-up: $5.25 back for $5 of credits clawed
		// back, so $0.25 of the fee is returned.
		await db.insert(tables.transaction).values({
			organizationId: ORG_ID,
			type: "credit_refund",
			amount: "5.25",
			creditAmount: "-5",
			status: "completed",
			relatedTransactionId: topup.id,
			createdAt: daysAgo(now, 1),
		});
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await db.delete(tables.transaction);
		await db.delete(tables.projectHourlyStats);
		await db.delete(tables.projectHourlyModelStats);
		await deleteAll();
	});

	it("adds gateway margin, reset passes and the PAYG fee to the cycle margin", async () => {
		const res = await app.request("/admin/devpass/kpis", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const kpis = (await res.json()) as KpisResponse;

		expect(kpis.totalRealCostCycle).toBe(100);
		expect(kpis.totalOverflowCostCycle).toBe(0);
		// Plan economics are unchanged: 79 − 100.
		expect(kpis.planMargin).toBe(-21);
		// Only the in-cycle carrier row, only the DevPass org.
		expect(kpis.gatewayMarginCycle).toBe(12);
		expect(kpis.resetPassesSold).toBe(2);
		expect(kpis.resetPassRevenue).toBe(58);
		expect(kpis.resetPassesSoldCycle).toBe(1);
		expect(kpis.resetPassRevenueCycle).toBe(29);
		// (26.25 − 25) charged above credits, minus (5.25 − 5) handed back.
		expect(kpis.paygFeeCycle).toBeCloseTo(1, 6);
		expect(kpis.paygFeeAllTime).toBeCloseTo(1, 6);
		expect(kpis.totalMargin).toBeCloseTo(-21 + 12 + 29 + 1, 6);
		// Over cycle revenue: MRR 79 + Reset Pass 29 + fee 1.
		expect(kpis.marginPct).toBeCloseTo((21 / 109) * 100, 6);
	});

	it("carries gateway margin through the timeseries margin", async () => {
		const from = isoDay(daysAgo(now, 30));
		const to = isoDay(now);
		const res = await app.request(
			`/admin/devpass/timeseries?from=${from}&to=${to}`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as TimeseriesResponse;

		expect(body.totals.gatewayMargin).toBe(17);
		// Plan start plus both Reset Passes.
		expect(body.totals.revenue).toBe(137);
		expect(body.totals.topupRevenue).toBe(21);
		expect(body.totals.cost).toBe(100);
		expect(body.totals.margin).toBe(137 + 21 + 17 - 100);
		expect(body.data.some((point) => point.gatewayMargin === 12)).toBe(true);
		expect(body.data.reduce((sum, point) => sum + point.margin, 0)).toBeCloseTo(
			body.totals.margin,
			6,
		);
	});

	it("usage reads all time when no range is given", async () => {
		const allTime = await app.request("/admin/devpass/usage", {
			headers: { Cookie: cookie },
		});
		expect(allTime.status).toBe(200);
		const allTimeBody = (await allTime.json()) as UsageResponse;
		expect(allTimeBody.range).toBeNull();
		expect(allTimeBody.models.map((m) => [m.id, m.cost]).sort()).toEqual([
			["carrier-model", 40],
			["older-model", 20],
		]);

		const from = isoDay(daysAgo(now, 7));
		const to = isoDay(now);
		const week = await app.request(
			`/admin/devpass/usage?from=${from}&to=${to}`,
			{ headers: { Cookie: cookie } },
		);
		expect(week.status).toBe(200);
		const weekBody = (await week.json()) as UsageResponse;
		expect(weekBody.range).toEqual({ from, to });
		expect(weekBody.models.map((m) => m.id)).toEqual(["carrier-model"]);
	});
});
