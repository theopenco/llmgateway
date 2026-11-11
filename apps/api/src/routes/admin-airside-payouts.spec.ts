import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;
const originalSupportEmails = process.env.ADMIN_SUPPORT_EMAILS;
const COMPANY_ID = "payout-spec-company";
const OTHER_COMPANY_ID = "payout-spec-other-company";
const STATEMENT_ID = "payout-spec-statement";

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

		const paid = await call(
			`/admin/airside/payouts/${STATEMENT_ID}/mark-paid`,
			"POST",
			{ paymentReference: "WIRE-123" },
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

	test("unknown statement is a 404", async () => {
		expect((await call("/admin/airside/payouts/missing/approve")).status).toBe(
			404,
		);
	});
});
