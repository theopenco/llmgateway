import { afterEach, beforeEach, expect, test } from "vitest";

import { db, inArray, tables } from "@llmgateway/db";

import { selectDevPassAudience } from "./devpass-audiences.js";
import { loadDevPassMemberships } from "./devpass-memberships.js";

// Ways the win-back reaches someone it must not: an account an admin blocked
// or disabled or that is flagged as high risk, an address that was never
// verified, a plan charge that was refunded, failed or is still pending, or a
// payment for another product.

const PREFIX = "winback-spec";
const ids = (name: string) => `${PREFIX}-${name}`;

interface Fixture {
	name: string;
	user?: Partial<typeof tables.user.$inferInsert>;
	organization?: Partial<typeof tables.organization.$inferInsert>;
	transactions?: Partial<typeof tables.transaction.$inferInsert>[];
}

const paid = { type: "dev_plan_start", status: "completed", amount: "79" } as const;

const fixtures: Fixture[] = [
	{ name: "left", transactions: [paid] },
	{
		name: "risk-flagged",
		organization: { riskFlagged: true },
		transactions: [paid],
	},
	{
		name: "deactivated-user",
		user: { status: "deactivated" },
		transactions: [paid],
	},
	{ name: "legacy", transactions: [{ ...paid, type: "subscription_start" }] },
	{
		name: "blocked",
		user: { status: "deactivated" },
		organization: { status: "deleted" },
		transactions: [paid],
	},
	{ name: "disabled", organization: { status: "inactive" }, transactions: [paid] },
	{ name: "unverified", user: { emailVerified: false }, transactions: [paid] },
	{ name: "failed", transactions: [{ ...paid, status: "failed" }] },
	{ name: "pending", transactions: [{ ...paid, status: "pending" }] },
	{ name: "never-paid" },
	{ name: "topup-only", transactions: [{ ...paid, type: "credit_topup" }] },
	{
		name: "wrong-product",
		organization: { kind: "default" },
		transactions: [paid],
	},
	{
		name: "refunded",
		transactions: [
			{ ...paid, id: ids("refunded-charge") },
			{
				type: "credit_refund",
				status: "completed",
				amount: "79",
				relatedTransactionId: ids("refunded-charge"),
			},
		],
	},
	{
		name: "refunded-then-paid",
		transactions: [
			{ ...paid, id: ids("first-charge") },
			{
				type: "credit_refund",
				status: "completed",
				amount: "79",
				relatedTransactionId: ids("first-charge"),
			},
			{ ...paid, type: "dev_plan_renewal" },
		],
	},
	{
		name: "running",
		organization: {
			devPlan: "pro",
			devPlanStripeSubscriptionId: "sub_winback_spec",
		},
		transactions: [paid],
	},
];

beforeEach(async () => {
	for (const fixture of fixtures) {
		const id = ids(fixture.name);
		await db.insert(tables.user).values({
			id,
			name: fixture.name,
			email: `${fixture.name}@example.com`,
			emailVerified: true,
			...fixture.user,
		});
		await db.insert(tables.organization).values({
			id,
			name: fixture.name,
			billingEmail: `${fixture.name}@example.com`,
			kind: "devpass",
			devPlan: "none",
			...fixture.organization,
		});
		await db
			.insert(tables.userOrganization)
			.values({ userId: id, organizationId: id, role: "owner" });
		for (const transaction of fixture.transactions ?? []) {
			await db
				.insert(tables.transaction)
				.values({ organizationId: id, type: "dev_plan_start", ...transaction });
		}
	}
});

afterEach(async () => {
	const all = fixtures.map((fixture) => ids(fixture.name));
	await db
		.delete(tables.transaction)
		.where(inArray(tables.transaction.organizationId, all));
	await db
		.delete(tables.userOrganization)
		.where(inArray(tables.userOrganization.organizationId, all));
	await db.delete(tables.organization).where(inArray(tables.organization.id, all));
	await db.delete(tables.user).where(inArray(tables.user.id, all));
});

async function audience(name: "active" | "past" | "past-due") {
	const mine = (await loadDevPassMemberships()).filter((row) =>
		fixtures.some((fixture) => row.email === `${fixture.name}@example.com`),
	);
	return selectDevPassAudience(mine, name, new Date()).map((row) => row.email);
}

test("the win-back reaches only reachable people with an unrefunded plan charge", async () => {
	expect(await audience("past")).toEqual([
		"left@example.com",
		"legacy@example.com",
		"refunded-then-paid@example.com",
	]);
});

test("a running plan is active and never won back", async () => {
	expect(await audience("active")).toEqual(["running@example.com"]);
});
