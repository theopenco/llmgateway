import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;
const originalSupportEmails = process.env.ADMIN_SUPPORT_EMAILS;
const COMPANY_ID = "payout-spec-company";
const OTHER_COMPANY_ID = "payout-spec-other-company";
const STATEMENT_ID = "payout-spec-statement";
const CARRIER = "payout-spec-carrier";

interface Statement {
	id: string;
	providerName: string;
	grossAmount: string;
	gatewayFeeAmount: string;
	adjustmentAmount: string;
	adjustmentNote: string | null;
	payoutAmount: string;
	status: string;
	approvedByEmail?: string | null;
	paidByEmail?: string | null;
	paymentReference: string | null;
	company?: { id: string; name: string };
}

describe("Airside payout statements", () => {
	let cookie: string;

	const call = (path: string, method = "POST", body?: unknown) =>
		app.request(path, {
			method,
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});

	const carrierStatements = async (companyId = COMPANY_ID) => {
		const response = await app.request(
			`/airside/payouts?providerCompanyId=${companyId}`,
			{ headers: { Cookie: cookie } },
		);
		return response;
	};

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		delete process.env.ADMIN_SUPPORT_EMAILS;
		cookie = await createTestUser();
		await db.insert(tables.providerCompany).values([
			{ id: COMPANY_ID, name: "Payout Spec Co" },
			{ id: OTHER_COMPANY_ID, name: "Other Co" },
		]);
		await db.insert(tables.providerCompanyMember).values({
			providerCompanyId: COMPANY_ID,
			userId: "test-user-id",
			role: "owner",
		});
		await db.insert(tables.providerClaim).values({
			providerCompanyId: COMPANY_ID,
			providerId: "payout-spec-carrier",
			matchedDomain: "payout-spec.example",
			customName: "Payout Spec Carrier",
			kind: "custom",
			status: "active",
			billingMode: "payout",
		});
		await db.insert(tables.airsidePayoutStatement).values({
			id: STATEMENT_ID,
			providerCompanyId: COMPANY_ID,
			providerId: "payout-spec-carrier",
			periodStart: new Date("2026-10-01T00:00:00Z"),
			periodEnd: new Date("2026-11-01T00:00:00Z"),
			requestCount: 12,
			grossAmount: "150.00",
			gatewayFeeAmount: "30.00",
		});
	});

	afterEach(async () => {
		await db
			.delete(tables.providerCompany)
			.where(eq(tables.providerCompany.id, COMPANY_ID));
		await db
			.delete(tables.providerCompany)
			.where(eq(tables.providerCompany.id, OTHER_COMPANY_ID));
		process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
		if (originalSupportEmails === undefined) {
			delete process.env.ADMIN_SUPPORT_EMAILS;
		} else {
			process.env.ADMIN_SUPPORT_EMAILS = originalSupportEmails;
		}
	});

	test("carrier sees its preview; other companies are refused", async () => {
		const response = await carrierStatements();
		expect(response.status).toBe(200);
		const { statements } = (await response.json()) as {
			statements: Statement[];
		};
		expect(statements).toEqual([
			expect.objectContaining({
				id: STATEMENT_ID,
				providerName: "Payout Spec Carrier",
				grossAmount: "150.00",
				gatewayFeeAmount: "30.00",
				adjustmentAmount: "0.00",
				payoutAmount: "120.00",
				status: "draft",
			}),
		]);

		expect((await carrierStatements(OTHER_COMPANY_ID)).status).toBe(404);
	});

	test("adjust, approve, reopen and mark paid", async () => {
		const unexplained = await call(
			`/admin/airside/payouts/${STATEMENT_ID}`,
			"PATCH",
			{ adjustmentAmount: "-5.5", adjustmentNote: null },
		);
		expect(unexplained.status).toBe(400);

		const adjusted = await call(
			`/admin/airside/payouts/${STATEMENT_ID}`,
			"PATCH",
			{ adjustmentAmount: "-5.5", adjustmentNote: "Refunded outage" },
		);
		expect(adjusted.status).toBe(200);
		expect((await adjusted.json()).statement).toMatchObject({
			adjustmentAmount: "-5.50",
			payoutAmount: "114.50",
			company: { id: COMPANY_ID, name: "Payout Spec Co" },
		});

		// Paying needs an approved statement.
		expect(
			(
				await call(`/admin/airside/payouts/${STATEMENT_ID}/mark-paid`, "POST", {
					payoutAmount: "114.50",
					paymentReference: null,
				})
			).status,
		).toBe(409);

		const approved = await call(
			`/admin/airside/payouts/${STATEMENT_ID}/approve`,
		);
		expect(approved.status).toBe(200);
		expect((await approved.json()).statement).toMatchObject({
			status: "approved",
			approvedByEmail: "admin@example.com",
		});
		// Approved amounts are frozen.
		expect(
			(
				await call(`/admin/airside/payouts/${STATEMENT_ID}`, "PATCH", {
					adjustmentAmount: "0",
					adjustmentNote: null,
				})
			).status,
		).toBe(409);

		expect(
			(await call(`/admin/airside/payouts/${STATEMENT_ID}/reopen`)).status,
		).toBe(200);
		expect(
			(await call(`/admin/airside/payouts/${STATEMENT_ID}/approve`)).status,
		).toBe(200);

		// An amount the statement no longer shows is refused.
		expect(
			(
				await call(`/admin/airside/payouts/${STATEMENT_ID}/mark-paid`, "POST", {
					payoutAmount: "120.00",
					paymentReference: null,
				})
			).status,
		).toBe(409);

		const paid = await call(
			`/admin/airside/payouts/${STATEMENT_ID}/mark-paid`,
			"POST",
			{ payoutAmount: "114.5", paymentReference: "WIRE-123" },
		);
		expect(paid.status).toBe(200);
		expect((await paid.json()).statement).toMatchObject({
			status: "paid",
			paidByEmail: "admin@example.com",
			paymentReference: "WIRE-123",
		});
		expect(
			(await call(`/admin/airside/payouts/${STATEMENT_ID}/reopen`)).status,
		).toBe(409);

		const listed = await app.request("/admin/airside/payouts?status=paid", {
			headers: { Cookie: cookie },
		});
		const { statements } = (await listed.json()) as {
			statements: Statement[];
		};
		expect(statements.map((statement) => statement.id)).toEqual([STATEMENT_ID]);

		const carrier = (await (await carrierStatements()).json()) as {
			statements: Statement[];
		};
		expect(carrier.statements[0]).toMatchObject({
			status: "paid",
			payoutAmount: "114.50",
			adjustmentNote: "Refunded outage",
		});
	});

	test("support cannot read payouts", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "";
		process.env.ADMIN_SUPPORT_EMAILS = "admin@example.com";
		const response = await app.request("/admin/airside/payouts", {
			headers: { Cookie: cookie },
		});
		expect(response.status).toBe(403);
	});

	test("approval waits for a recompute a day after the period", async () => {
		await db
			.update(tables.airsidePayoutStatement)
			.set({ computedAt: new Date("2026-11-01T06:00:00Z") })
			.where(eq(tables.airsidePayoutStatement.id, STATEMENT_ID));
		expect(
			(await call(`/admin/airside/payouts/${STATEMENT_ID}/approve`)).status,
		).toBe(409);
	});

	test("unknown statement is a 404", async () => {
		expect((await call("/admin/airside/payouts/missing/approve")).status).toBe(
			404,
		);
	});

	describe("backfill and report", () => {
		const statsRow = (
			usedModel: string,
			day: string,
			values: { cost: number; fee: number; requests: number },
			usedMode: "credits" | "api-keys" = "credits",
		) => ({
			dayTimestamp: new Date(day),
			usedModel,
			usedProvider: CARRIER,
			usedMode,
			orgKind: "default" as const,
			requestCount: values.requests,
			cacheCount: 1,
			inputTokens: "1000",
			cachedTokens: "200",
			cacheWriteTokens: "50",
			outputTokens: "300",
			reasoningTokens: "10",
			cost: values.cost,
			providerMarginAmount: values.fee,
		});

		beforeEach(async () => {
			await db
				.update(tables.providerClaim)
				.set({
					createdAt: new Date("2026-08-15T00:00:00Z"),
					reviewedAt: new Date("2026-08-15T00:00:00Z"),
				})
				.where(eq(tables.providerClaim.providerId, CARRIER));
			await db.insert(tables.globalModelStats).values([
				statsRow("model-a", "2026-09-02T00:00:00Z", {
					cost: 100,
					fee: 20,
					requests: 10,
				}),
				statsRow("model-a", "2026-09-30T00:00:00Z", {
					cost: 50.005,
					fee: 10,
					requests: 5,
				}),
				statsRow("model-b", "2026-09-10T00:00:00Z", {
					cost: 40,
					fee: 8,
					requests: 4,
				}),
				// BYOK and other months are not the carrier's payout.
				statsRow(
					"model-b",
					"2026-09-11T00:00:00Z",
					{ cost: 999, fee: 0, requests: 99 },
					"api-keys",
				),
				statsRow("model-a", "2026-10-01T00:00:00Z", {
					cost: 7,
					fee: 1,
					requests: 1,
				}),
			]);
		});

		afterEach(async () => {
			await db
				.delete(tables.globalModelStats)
				.where(eq(tables.globalModelStats.usedProvider, CARRIER));
		});

		test("opens a draft for a closed month once", async () => {
			const backfill = (month: string, providerId = CARRIER) =>
				call("/admin/airside/payouts/backfill", "POST", { providerId, month });

			const created = await backfill("2026-09");
			expect(created.status).toBe(201);
			expect((await created.json()).statement).toMatchObject({
				status: "draft",
				requestCount: 19,
				grossAmount: "190.01",
				gatewayFeeAmount: "38.00",
				payoutAmount: "152.01",
				company: { id: COMPANY_ID },
			});

			expect((await backfill("2026-09")).status).toBe(409);
			// Not live yet, not ended yet, not a payout carrier.
			expect((await backfill("2026-07")).status).toBe(400);
			expect((await backfill("2999-01")).status).toBe(400);
			expect((await backfill("2026-09", "unknown-carrier")).status).toBe(400);

			const listed = await app.request("/admin/airside/payouts", {
				headers: { Cookie: cookie },
			});
			expect((await listed.json()).carriers).toEqual([
				{
					providerId: CARRIER,
					name: "Payout Spec Carrier",
					liveSince: "2026-08-15T00:00:00.000Z",
				},
			]);
		});

		test("carrier downloads a per-model CSV of its statement only", async () => {
			const { statement } = await (
				await call("/admin/airside/payouts/backfill", "POST", {
					providerId: CARRIER,
					month: "2026-09",
				})
			).json();

			const response = await app.request(
				`/airside/payouts/${statement.id}/report?providerCompanyId=${COMPANY_ID}`,
				{ headers: { Cookie: cookie } },
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/csv");
			expect(response.headers.get("content-disposition")).toContain(
				`airside-payout-${CARRIER}-2026-09.csv`,
			);
			expect((await response.text()).trimEnd().split("\n")).toEqual([
				"period,provider,model,requests,cache_hits,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,reasoning_tokens,billed_usd,gateway_fee_usd",
				`2026-09,${CARRIER},model-a,15,2,2000,400,100,600,20,150.01,30.00`,
				`2026-09,${CARRIER},model-b,4,1,1000,200,50,300,10,40.00,8.00`,
			]);

			// Another company's id, or a statement outside the company, is a 404.
			expect(
				(
					await app.request(
						`/airside/payouts/${statement.id}/report?providerCompanyId=${OTHER_COMPANY_ID}`,
						{ headers: { Cookie: cookie } },
					)
				).status,
			).toBe(404);
			await db.insert(tables.providerCompanyMember).values({
				providerCompanyId: OTHER_COMPANY_ID,
				userId: "test-user-id",
				role: "owner",
			});
			expect(
				(
					await app.request(
						`/airside/payouts/${statement.id}/report?providerCompanyId=${OTHER_COMPANY_ID}`,
						{ headers: { Cookie: cookie } },
					)
				).status,
			).toBe(404);
		});
	});
});
