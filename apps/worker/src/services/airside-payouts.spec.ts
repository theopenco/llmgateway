import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { db, eq, inArray, tables } from "@llmgateway/db";

import { refreshAirsidePayoutStatements } from "./airside-payouts.js";

// Historical month, so rollups never collide with real aggregates.
const NOW = new Date("2001-04-15T12:00:00Z");
const PERIOD_START = new Date("2001-03-01T00:00:00Z");

describe("refreshAirsidePayoutStatements", () => {
	let suffix = "";
	let companyId = "";
	let payoutProvider = "";
	let paygProvider = "";

	const stats = (
		providerId: string,
		day: string,
		values: {
			usedMode?: "credits" | "api-keys";
			cost: number;
			providerMarginAmount: number;
			requestCount: number;
		},
	) => ({
		dayTimestamp: new Date(day),
		usedModel: `${providerId}/model-${suffix}`,
		usedProvider: providerId,
		usedMode: values.usedMode ?? "credits",
		orgKind: "default" as const,
		cost: values.cost,
		providerMarginAmount: values.providerMarginAmount,
		requestCount: values.requestCount,
	});

	const statementsFor = (providerId: string) =>
		db
			.select()
			.from(tables.airsidePayoutStatement)
			.where(eq(tables.airsidePayoutStatement.providerId, providerId));

	beforeEach(async () => {
		suffix = randomUUID().slice(0, 8);
		companyId = `payout-co-${suffix}`;
		payoutProvider = `payout-carrier-${suffix}`;
		paygProvider = `payg-carrier-${suffix}`;
		await db
			.insert(tables.providerCompany)
			.values({ id: companyId, name: "Payout Co" });
		await db.insert(tables.providerClaim).values([
			{
				providerCompanyId: companyId,
				providerId: payoutProvider,
				matchedDomain: "payout.example",
				status: "active",
				billingMode: "payout",
				reviewedAt: new Date("2001-01-10T00:00:00Z"),
			},
			{
				providerCompanyId: companyId,
				providerId: paygProvider,
				matchedDomain: "payout.example",
				status: "active",
				billingMode: "payg",
				reviewedAt: new Date("2001-01-10T00:00:00Z"),
			},
		]);
		await db.insert(tables.globalModelStats).values([
			stats(payoutProvider, "2001-03-01T00:00:00Z", {
				cost: 100.004,
				providerMarginAmount: 20.001,
				requestCount: 10,
			}),
			stats(payoutProvider, "2001-03-31T00:00:00Z", {
				cost: 50,
				providerMarginAmount: 15,
				requestCount: 5,
			}),
			// BYOK pays the carrier directly.
			stats(payoutProvider, "2001-03-15T00:00:00Z", {
				usedMode: "api-keys",
				cost: 999,
				providerMarginAmount: 0,
				requestCount: 99,
			}),
			// Outside the period on both ends.
			stats(payoutProvider, "2001-02-28T00:00:00Z", {
				cost: 7,
				providerMarginAmount: 1,
				requestCount: 1,
			}),
			stats(payoutProvider, "2001-04-01T00:00:00Z", {
				cost: 7,
				providerMarginAmount: 1,
				requestCount: 1,
			}),
			stats(paygProvider, "2001-03-10T00:00:00Z", {
				cost: 40,
				providerMarginAmount: 8,
				requestCount: 4,
			}),
		]);
	});

	afterEach(async () => {
		await db
			.delete(tables.globalModelStats)
			.where(
				inArray(tables.globalModelStats.usedProvider, [
					payoutProvider,
					paygProvider,
				]),
			);
		await db
			.delete(tables.providerCompany)
			.where(eq(tables.providerCompany.id, companyId));
	});

	test("opens last month's draft for payout carriers only", async () => {
		await refreshAirsidePayoutStatements(NOW);

		const [statement] = await statementsFor(payoutProvider);
		expect(statement).toMatchObject({
			providerCompanyId: companyId,
			status: "draft",
			requestCount: 15,
			grossAmount: "150.00",
			gatewayFeeAmount: "35.00",
			adjustmentAmount: "0",
		});
		expect(statement.periodStart.toISOString()).toBe(
			PERIOD_START.toISOString(),
		);
		expect(statement.periodEnd.toISOString()).toBe("2001-04-01T00:00:00.000Z");
		expect(await statementsFor(paygProvider)).toHaveLength(0);
	});

	test("refreshes drafts but never an approved statement", async () => {
		await refreshAirsidePayoutStatements(NOW);
		await db.insert(tables.globalModelStats).values(
			stats(payoutProvider, "2001-03-20T00:00:00Z", {
				cost: 10,
				providerMarginAmount: 2,
				requestCount: 1,
			}),
		);
		await refreshAirsidePayoutStatements(NOW);
		let [statement] = await statementsFor(payoutProvider);
		expect(statement.grossAmount).toBe("160.00");

		await db
			.update(tables.airsidePayoutStatement)
			.set({ status: "approved" })
			.where(eq(tables.airsidePayoutStatement.id, statement.id));
		await db.insert(tables.globalModelStats).values(
			stats(payoutProvider, "2001-03-21T00:00:00Z", {
				cost: 10,
				providerMarginAmount: 2,
				requestCount: 1,
			}),
		);
		await refreshAirsidePayoutStatements(NOW);
		[statement] = await statementsFor(payoutProvider);
		expect(statement).toMatchObject({
			status: "approved",
			grossAmount: "160.00",
		});
		expect(await statementsFor(payoutProvider)).toHaveLength(1);
	});

	test("settles a carrier revoked after the period began", async () => {
		// Revoking overwrites reviewedAt with the revocation time.
		await db
			.update(tables.providerClaim)
			.set({
				status: "revoked",
				revokedAt: new Date("2001-04-03T00:00:00Z"),
				reviewedAt: new Date("2001-04-03T00:00:00Z"),
				createdAt: new Date("2001-01-01T00:00:00Z"),
			})
			.where(eq(tables.providerClaim.providerId, payoutProvider));

		await refreshAirsidePayoutStatements(NOW);

		const [statement] = await statementsFor(payoutProvider);
		expect(statement?.grossAmount).toBe("150.00");
	});

	test("skips carriers that went live after the period", async () => {
		await db
			.update(tables.providerClaim)
			.set({ reviewedAt: new Date("2001-04-02T00:00:00Z") })
			.where(eq(tables.providerClaim.providerId, payoutProvider));

		await refreshAirsidePayoutStatements(NOW);

		expect(await statementsFor(payoutProvider)).toHaveLength(0);
	});
});
