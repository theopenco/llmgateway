import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { getOrgTierQualifyingSpendUsd } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";

const exec = promisify(execFile);
const ORG = "refund-classification-org";
const OTHER = "refund-classification-other";
let cookie: string;

async function charge(
	id: string,
	overrides: Partial<typeof tables.transaction.$inferInsert> = {},
) {
	const [row] = await db
		.insert(tables.transaction)
		.values({
			id,
			organizationId: ORG,
			type: "dev_plan_start",
			amount: "29.01",
			creditAmount: "87",
			status: "completed",
			...overrides,
		})
		.returning();
	return row;
}

async function refund(
	id: string,
	originalId: string | null,
	overrides: Partial<typeof tables.transaction.$inferInsert> = {},
) {
	return await charge(id, {
		type: "credit_refund",
		amount: "10.01",
		creditAmount: "0",
		relatedTransactionId: originalId,
		description: "Credit refund: fixture",
		...overrides,
	});
}

async function runBackfill(commit = false) {
	return await exec(
		process.execPath,
		[
			"--import",
			"tsx",
			resolve("packages/scripts/src/backfill-subscription-refunds.ts"),
			`--organization-id=${ORG}`,
			...(commit ? ["--commit"] : []),
		],
		{
			env: process.env,
			timeout: 20000,
		},
	);
}

beforeEach(async () => {
	cookie = await createTestUser();
	await db.insert(tables.organization).values([
		{
			id: ORG,
			name: "Test Organization",
			billingEmail: "test@example.com",
			kind: "devpass",
			credits: "12.34",
			devPlan: "pro",
			devPlanStripeSubscriptionId: "sub_fixture_plan",
		},
		{
			id: OTHER,
			name: "Other Test Organization",
			billingEmail: "test@example.com",
		},
	]);
	await db
		.insert(tables.userOrganization)
		.values({ userId: "test-user-id", organizationId: ORG, role: "owner" });
});

afterEach(async () => {
	await db.delete(tables.transaction);
	await deleteAll();
});

async function checkBackfillIdempotence() {
	await charge("plan-payment");
	await refund("plan-refund", "plan-payment");
	await charge("other-payment", { organizationId: OTHER });
	await refund("other-refund", "other-payment", { organizationId: OTHER });
	const orgBefore = await db.query.organization.findFirst({
		where: { id: { eq: ORG } },
	});
	await runBackfill();
	expect(
		(
			await db.query.transaction.findFirst({
				where: { id: { eq: "plan-refund" } },
			})
		)?.type,
	).toBe("credit_refund");
	await runBackfill(true);
	const first = await db.query.transaction.findFirst({
		where: { id: { eq: "plan-refund" } },
	});
	expect(first).toMatchObject({
		type: "subscription_refund",
		amount: "10.01",
		creditAmount: "0",
		relatedTransactionId: "plan-payment",
		description: "Subscription refund: fixture",
	});
	await runBackfill(true);
	expect(
		await db.query.transaction.findFirst({
			where: { id: { eq: "plan-refund" } },
		}),
	).toEqual(first);
	expect(
		(
			await db.query.transaction.findFirst({
				where: { id: { eq: "other-refund" } },
			})
		)?.type,
	).toBe("credit_refund");
	expect(
		await db.query.organization.findFirst({ where: { id: { eq: ORG } } }),
	).toEqual(orgBefore);
}

async function checkUnsafeRows() {
	await charge("plan-payment");
	await charge("topup", { type: "credit_topup" });
	await charge("gift", { type: "credit_gift" });
	await charge("other-payment", { organizationId: OTHER });
	await refund("topup-refund", "topup");
	await refund("unlinked", null);
	await refund("dangling", "missing");
	await refund("cross-org", "other-payment");
	await refund("unknown", "gift");
	await refund("nonzero-credit", "plan-payment", { creditAmount: "-0.01" });
	await refund("failed", "plan-payment", { status: "failed" });
	await refund("negative", "plan-payment", { amount: "-1" });
	const { stderr } = await runBackfill(true);
	expect(stderr).toContain("UNRESOLVED");
	expect(stderr).toContain("SKIP");
	expect(
		await db.query.transaction.findMany({
			where: { type: { eq: "subscription_refund" } },
		}),
	).toHaveLength(0);
}

async function checkTierPolicy() {
	await db.insert(tables.project).values({
		id: "refund-tier-project",
		name: "Test Project",
		organizationId: ORG,
	});
	await db.insert(tables.projectHourlyStats).values({
		projectId: "refund-tier-project",
		hourTimestamp: new Date(),
		cost: 300,
		creditsCost: 150,
	});
	await charge("plan-payment", { amount: "150" });
	await refund("legacy-refund", "plan-payment", { amount: "25" });
	await refund("new-refund", "plan-payment", {
		type: "subscription_refund",
		amount: "50",
	});
	await refund("pending-refund", "plan-payment", {
		type: "subscription_refund",
		status: "pending",
		amount: "100",
	});
	await refund("other-refund", null, {
		organizationId: OTHER,
		type: "subscription_refund",
		amount: "500",
	});
	expect(await getOrgTierQualifyingSpendUsd(ORG)).toBe(75);
	await runBackfill(true);
	expect(await getOrgTierQualifyingSpendUsd(ORG)).toBe(75);
}

async function checkHistory(type: "credit_refund" | "subscription_refund") {
	await charge("plan-payment", { stripeInvoiceId: "in_fixture_plan" });
	await refund("history-refund", "plan-payment", { type, amount: "29.01" });
	const res = await app.request("/dev-plans/invoices", {
		headers: { Cookie: cookie },
	});
	expect(res.status).toBe(200);
	const body = (await res.json()) as {
		invoices: {
			id: string;
			type: string;
			refund?: { eligible: boolean; reason?: string };
		}[];
	};
	const row = body.invoices.find((t) => t.id === "history-refund");
	expect(row?.type).toBe(type);
	expect(row?.refund).toBeUndefined();
	expect(
		body.invoices.find((t) => t.id === "plan-payment")?.refund,
	).toMatchObject({ eligible: false, reason: "already_refunded" });
}

describe("subscription refund classification", () => {
	test(
		"scoped CLI is dry-run-first, idempotent and preserves balances and entitlements",
		checkBackfillIdempotence,
	);
	test(
		"leaves top-ups, unlinked, cross-org, unknown, nonzero-credit and failed rows for review",
		checkUnsafeRows,
	);
	test(
		"old and new completed refunds retain the documented tier deduction and org boundary",
		checkTierPolicy,
	);
	test.each(["credit_refund", "subscription_refund"] as const)(
		"history exposes %s without offering another refund",
		checkHistory,
	);
});
