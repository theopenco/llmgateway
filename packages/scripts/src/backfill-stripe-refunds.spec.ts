import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";

import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { legacyPass, sweepPass } from "./backfill-stripe-refunds.js";

let org: string;
let stripe: Stripe;
let server: ReturnType<typeof createServer>;
let refunds: {
	id: string;
	payment_intent: string;
	amount: number;
	status: string;
	created: number;
	currency: string;
}[];
let invoiceByPI: Record<string, string>;
let requests: string[];

beforeEach(async () => {
	org = randomUUID();
	refunds = [];
	invoiceByPI = {};
	requests = [];
	await db.insert(tables.organization).values({
		id: org,
		name: "Test Organization",
		billingEmail: "test@example.com",
		kind: "devpass",
		credits: "12.34",
		devPlan: "pro",
	});
	server = createServer((req, res) => {
		requests.push(`${req.method} ${req.url}`);
		res.setHeader("content-type", "application/json");
		const url = new URL(req.url ?? "/", "http://localhost");
		if (req.method !== "GET") {
			res.writeHead(405);
			res.end(JSON.stringify({ error: { message: "Fixture is read-only" } }));
			return;
		}
		if (url.pathname === "/v1/refunds") {
			const pi = url.searchParams.get("payment_intent");
			const rows = refunds.filter((r) => !pi || r.payment_intent === pi);
			const after = url.searchParams.get("starting_after");
			const start = after ? rows.findIndex((r) => r.id === after) + 1 : 0;
			res.end(
				JSON.stringify({
					object: "list",
					data: refundPage(rows, start),
					has_more: start + 1 < rows.length,
					url: "/v1/refunds",
				}),
			);
			return;
		}
		if (url.pathname === "/v1/invoice_payments") {
			const pi = url.searchParams.get("payment[payment_intent]") ?? "";
			res.end(
				JSON.stringify({
					object: "list",
					data: invoiceByPI[pi] ? [{ invoice: invoiceByPI[pi] }] : [],
					has_more: false,
					url: "/v1/invoice_payments",
				}),
			);
			return;
		}
		res.writeHead(404);
		res.end(
			JSON.stringify({ error: { message: "Unexpected fixture endpoint" } }),
		);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("No fixture port");
	}
	stripe = new Stripe(["sk", "test", "fixture"].join("_"), {
		apiVersion: "2025-04-30.basil",
		host: "127.0.0.1",
		port: address.port,
		protocol: "http",
		maxNetworkRetries: 0,
	});
});

afterEach(async () => {
	await new Promise<void>((done, reject) =>
		server.close((error) => (error ? reject(error) : done())),
	);
	await db
		.delete(tables.transaction)
		.where(eq(tables.transaction.organizationId, org));
	await db.delete(tables.organization).where(eq(tables.organization.id, org));
});

async function payment(
	id: string,
	overrides: Partial<typeof tables.transaction.$inferInsert> = {},
) {
	const [row] = await db
		.insert(tables.transaction)
		.values({
			id: `${org}-${id}`,
			organizationId: org,
			type: "dev_plan_start",
			amount: "29.01",
			creditAmount: "87",
			status: "completed",
			stripePaymentIntentId: `${org}-${id}`,
			...overrides,
		})
		.returning();
	return row;
}

function addRefund(
	id: string,
	pi: string,
	amount = 1001,
	status = "succeeded",
	currency = "usd",
) {
	refunds.push({
		id: `${org}-${id}`,
		payment_intent: pi,
		amount,
		status,
		created: 1750000000,
		currency,
	});
}

async function checkSweep() {
	const original = await payment("invoice", {
		stripePaymentIntentId: null,
		stripeInvoiceId: `${org}-invoice`,
	});
	invoiceByPI[`${org}-pi`] = `${org}-invoice`;
	addRefund("one", `${org}-pi`);
	addRefund("two", `${org}-pi`, 29);
	addRefund("pending", `${org}-pi`, 10, "pending");
	await Promise.all([
		sweepPass(stripe, true, undefined),
		sweepPass(stripe, true, undefined),
	]);
	await sweepPass(stripe, true, undefined);
	const rows = await db.query.transaction.findMany({
		where: { organizationId: { eq: org }, type: { eq: "subscription_refund" } },
		orderBy: { amount: "asc" },
	});
	expect(rows.map((row) => row.amount)).toEqual(["0.29", "10.01"]);
	expect(
		rows.every(
			(row) =>
				row.creditAmount === "0" && row.relatedTransactionId === original.id,
		),
	).toBe(true);
	expect(requests.some((url) => url.includes("starting_after="))).toBe(true);
	expect(requests.every((url) => url.startsWith("GET "))).toBe(true);
	expect(
		(await db.query.organization.findFirst({ where: { id: { eq: org } } }))
			?.credits,
	).toBe("12.34");
}

async function checkSideEffects() {
	for (const type of ["credit_topup", "dev_plan_reset_pass"] as const) {
		const original = await payment(type, { type });
		addRefund(type, original.stripePaymentIntentId!);
	}
	const covered = await payment("covered");
	addRefund("covered", covered.stripePaymentIntentId!);
	await payment("legacy", {
		type: "credit_refund",
		stripePaymentIntentId: covered.stripePaymentIntentId,
		relatedTransactionId: covered.id,
		creditAmount: "0",
	});
	await sweepPass(stripe, true, undefined);
	expect(
		await db.query.transaction.findMany({
			where: {
				organizationId: { eq: org },
				type: { eq: "subscription_refund" },
			},
		}),
	).toHaveLength(0);
}

async function checkLegacy() {
	const original = await payment("original");
	await payment("legacy", {
		type: "credit_refund",
		stripePaymentIntentId: original.stripePaymentIntentId,
		relatedTransactionId: original.id,
		amount: "20.02",
		creditAmount: "0",
	});
	await payment("earlier-legacy", {
		type: "credit_refund",
		relatedTransactionId: original.id,
		stripePaymentIntentId: original.stripePaymentIntentId,
		amount: "10.01",
		creditAmount: "0",
	});
	addRefund("one", original.stripePaymentIntentId!);
	addRefund("two", original.stripePaymentIntentId!);
	await legacyPass(stripe, true, original.stripePaymentIntentId!);
	await legacyPass(stripe, true, original.stripePaymentIntentId!);
	expect(
		await db.query.transaction.findMany({
			where: {
				organizationId: { eq: org },
				type: { eq: "subscription_refund" },
			},
		}),
	).toHaveLength(2);
	expect(
		await db.query.transaction.findFirst({
			where: { id: { eq: `${org}-legacy` } },
		}),
	).toBeUndefined();
}

describe("refund backfill with isolated PostgreSQL and Stripe SDK loopback", () => {
	test(
		"paginates exact invoice linkage and concurrent duplicate deliveries without credit mutations",
		checkSweep,
	);
	test(
		"leaves top-up, Reset Pass and legacy-covered misses for manual review",
		checkSideEffects,
	);
	test(
		"replaces cumulative legacy rows once using individual succeeded refunds",
		checkLegacy,
	);
});
async function checkActivePlan() {
	const original = await payment("active-plan");
	await db
		.update(tables.organization)
		.set({ devPlanStripeSubscriptionId: "sub_fixture_active" })
		.where(eq(tables.organization.id, org));
	addRefund("full", original.stripePaymentIntentId!, 2901);
	await sweepPass(stripe, true, original.stripePaymentIntentId!);
	expect(
		await db.query.transaction.findMany({
			where: {
				organizationId: { eq: org },
				type: { eq: "subscription_refund" },
			},
		}),
	).toHaveLength(0);
}
async function checkUnsafeLegacy() {
	const original = await payment("unsafe-original");
	await payment("unsafe-legacy", {
		type: "credit_refund",
		stripePaymentIntentId: original.stripePaymentIntentId,
		relatedTransactionId: original.id,
		amount: "10.01",
		creditAmount: "0",
	});
	addRefund("exceeds", original.stripePaymentIntentId!, 5000);
	await legacyPass(stripe, true, original.stripePaymentIntentId!);
	expect(
		await db.query.transaction.findFirst({
			where: { id: { eq: `${org}-unsafe-legacy` } },
		}),
	).toBeDefined();
	expect(
		await db.query.transaction.findMany({
			where: {
				organizationId: { eq: org },
				type: { eq: "subscription_refund" },
			},
		}),
	).toHaveLength(0);
}
test(
	"does not mask cancellation recovery for active plan refunds",
	checkActivePlan,
);
test(
	"does not delete legacy history when Stripe exceeds the original purchase",
	checkUnsafeLegacy,
);
async function checkConflictingLegacy() {
	const original = await payment("conflict-original");
	await payment("conflict-legacy", {
		type: "credit_refund",
		stripePaymentIntentId: original.stripePaymentIntentId,
		relatedTransactionId: original.id,
		amount: "20.02",
		creditAmount: "0",
	});
	addRefund("conflict", original.stripePaymentIntentId!, 2002);
	await payment("existing-conflict", {
		type: "credit_refund",
		stripeRefundId: `${org}-conflict`,
		stripePaymentIntentId: original.stripePaymentIntentId,
		relatedTransactionId: original.id,
		amount: "9",
		creditAmount: "0",
	});
	await expect(
		legacyPass(stripe, true, original.stripePaymentIntentId!),
	).rejects.toThrow("Conflicting existing refund");
	expect(
		await db.query.transaction.findFirst({
			where: { id: { eq: `${org}-conflict-legacy` } },
		}),
	).toBeDefined();
}
async function checkLegacyInvoiceLink() {
	const original = await payment("invoice-original", {
		stripePaymentIntentId: null,
		stripeInvoiceId: `${org}-invoice`,
	});
	await payment("invoice-legacy", {
		type: "credit_refund",
		stripePaymentIntentId: `${org}-pi`,
		relatedTransactionId: original.id,
		amount: "10.01",
		creditAmount: "0",
	});
	addRefund("invoice-refund", `${org}-pi`);
	await legacyPass(stripe, true, `${org}-pi`);
	expect(
		await db.query.transaction.findFirst({
			where: { id: { eq: `${org}-invoice-legacy` } },
		}),
	).toBeDefined();
	invoiceByPI[`${org}-pi`] = `${org}-invoice`;
	await Promise.all([
		legacyPass(stripe, true, `${org}-pi`),
		legacyPass(stripe, true, `${org}-pi`),
	]);
	expect(
		await db.query.transaction.findMany({
			where: {
				organizationId: { eq: org },
				type: { eq: "subscription_refund" },
			},
		}),
	).toHaveLength(1);
}
test(
	"rolls back legacy deletion when an existing refund conflicts",
	checkConflictingLegacy,
);
test(
	"verifies invoice ownership and serializes concurrent legacy replacements",
	checkLegacyInvoiceLink,
);
async function checkSweepSourceAmounts() {
	const capped = await payment("aggregate-cap");
	addRefund("cap-one", capped.stripePaymentIntentId!, 2000);
	addRefund("cap-two", capped.stripePaymentIntentId!, 2000);
	const currency = await payment("wrong-currency");
	addRefund(
		"currency",
		currency.stripePaymentIntentId!,
		1001,
		"succeeded",
		"eur",
	);
	await sweepPass(stripe, true, undefined);
	expect(
		await db.query.transaction.findMany({
			where: {
				organizationId: { eq: org },
				type: { eq: "subscription_refund" },
			},
		}),
	).toHaveLength(0);
}
test(
	"rejects aggregate over-refunds and mismatched Stripe currency",
	checkSweepSourceAmounts,
);
async function runBackfillCLI(pi: string, commit: boolean) {
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("No fixture port");
	}
	const env: NodeJS.ProcessEnv = {
		...process.env,
		STRIPE_SECRET_KEY: ["sk", "test", "fixture"].join("_"),
	};
	delete env.TEST_DATABASE_URL;
	return await promisify(execFile)(
		process.execPath,
		[
			"--import",
			"tsx",
			"--eval",
			`import Stripe from "stripe";
		import { pathToFileURL } from "node:url";
		const original = Stripe.prototype._getPropsFromConfig;
		Stripe.prototype._getPropsFromConfig = function(config) {
			return { ...original.call(this, config), host: "127.0.0.1", port: ${address.port}, protocol: "http", maxNetworkRetries: 0 };
		};
		await import(pathToFileURL(process.argv[1]).href);`,
			resolve("packages/scripts/src/backfill-stripe-refunds.ts"),
			`--payment-intent=${pi}`,
			...(commit ? ["--commit"] : []),
		],
		{ cwd: resolve("packages/scripts"), env, timeout: 20000 },
	);
}
async function ledgerSnapshot() {
	return {
		organization: await db.query.organization.findFirst({
			where: { id: { eq: org } },
		}),
		transactions: await db.query.transaction.findMany({
			where: { organizationId: { eq: org } },
			orderBy: { id: "asc" },
		}),
	};
}

test.each([false, true])(
	"actual CLI preserves a singly undercovered legacy row (commit=%s)",
	async (commit) => {
		const original = await payment("undercovered-original", { amount: "100" });
		await payment("undercovered-legacy", {
			type: "credit_refund",
			relatedTransactionId: original.id,
			stripePaymentIntentId: original.stripePaymentIntentId,
			amount: "60",
			creditAmount: "0",
		});
		addRefund("undercovered", original.stripePaymentIntentId!, 1000);
		const before = await ledgerSnapshot();
		const result = await runBackfillCLI(
			original.stripePaymentIntentId!,
			commit,
		);
		expect(await ledgerSnapshot()).toEqual(before);
		expect(result.stderr).toContain("does not cover every legacy row");
		expect(result.stdout).toContain("0 legacy row(s) planned for deletion");
		expect(requests.every((request) => request.startsWith("GET "))).toBe(true);
	},
);

test.each([false, true])(
	"actual CLI cannot borrow another PI's refund evidence (commit=%s)",
	async (commit) => {
		const originals = [];
		for (const [id, cents] of [
			["first", 1000],
			["second", 5000],
		] as const) {
			const original = await payment(`${id}-original`, { amount: "100" });
			originals.push(original);
			await payment(`${id}-legacy`, {
				type: "credit_refund",
				relatedTransactionId: original.id,
				stripePaymentIntentId: original.stripePaymentIntentId,
				amount: "60",
				creditAmount: "0",
			});
			addRefund(id, original.stripePaymentIntentId!, cents);
		}
		const before = await ledgerSnapshot();
		for (const original of originals) {
			const result = await runBackfillCLI(
				original.stripePaymentIntentId!,
				commit,
			);
			expect(await ledgerSnapshot()).toEqual(before);
			expect(result.stderr).toContain("does not cover every legacy row");
			expect(result.stdout).toContain("0 legacy row(s) planned for deletion");
		}
		expect(requests.every((request) => request.startsWith("GET "))).toBe(true);
	},
);

test.each([false, true])(
	"actual CLI preserves the entire PI with an unverifiable legacy sibling (commit=%s)",
	async (commit) => {
		const original = await payment("sibling-original");
		await payment("safe-sibling", {
			type: "credit_refund",
			relatedTransactionId: original.id,
			stripePaymentIntentId: original.stripePaymentIntentId,
			amount: "10.01",
			creditAmount: "0",
		});
		await payment("unsafe-sibling", {
			type: "credit_refund",
			relatedTransactionId: null,
			stripePaymentIntentId: original.stripePaymentIntentId,
			amount: "20.02",
			creditAmount: "0",
		});
		addRefund("sibling", original.stripePaymentIntentId!);
		const before = await ledgerSnapshot();
		const result = await runBackfillCLI(
			original.stripePaymentIntentId!,
			commit,
		);
		expect(await ledgerSnapshot()).toEqual(before);
		expect(result.stderr).toContain("Unverified legacy rows");
	},
);

test.each([null, "NaN", "Infinity", "0", "-1"])(
	"preserves invalid legacy amounts (%s)",
	async (amount) => {
		const original = await payment("invalid-original");
		await payment("invalid-legacy", {
			type: "credit_refund",
			relatedTransactionId: original.id,
			stripePaymentIntentId: original.stripePaymentIntentId,
			amount,
			creditAmount: "0",
		});
		addRefund("invalid", original.stripePaymentIntentId!);
		const before = await ledgerSnapshot();
		for (const commit of [false, true]) {
			await legacyPass(stripe, commit, original.stripePaymentIntentId!);
			await sweepPass(stripe, commit, original.stripePaymentIntentId!);
			expect(await ledgerSnapshot()).toEqual(before);
		}
	},
);

test.each([false, true])(
	"preserves unknown original currency (commit=%s)",
	async (commit) => {
		const original = await payment("unknown-currency", { currency: "" });
		await payment("currency-legacy", {
			type: "credit_refund",
			relatedTransactionId: original.id,
			stripePaymentIntentId: original.stripePaymentIntentId,
			amount: "10.01",
			creditAmount: "0",
		});
		addRefund("currency-refund", original.stripePaymentIntentId!);
		const before = await ledgerSnapshot();
		await runBackfillCLI(original.stripePaymentIntentId!, commit);
		expect(await ledgerSnapshot()).toEqual(before);
	},
);

test("duplicate Stripe IDs cannot overstate succeeded coverage", async () => {
	const original = await payment("duplicate-original");
	await payment("duplicate-legacy", {
		type: "credit_refund",
		relatedTransactionId: original.id,
		stripePaymentIntentId: original.stripePaymentIntentId,
		amount: "20.02",
		creditAmount: "0",
	});
	addRefund("duplicate", original.stripePaymentIntentId!);
	addRefund("duplicate", original.stripePaymentIntentId!);
	const before = await ledgerSnapshot();
	for (const commit of [false, true]) {
		await legacyPass(stripe, commit, original.stripePaymentIntentId!);
		await sweepPass(stripe, commit, original.stripePaymentIntentId!);
		expect(await ledgerSnapshot()).toEqual(before);
	}
});

test.each(["currency", "paymentIntent"] as const)(
	"canonical refund %s conflicts retain legacy history",
	async (field) => {
		const original = await payment("canonical-original");
		await payment("canonical-legacy", {
			type: "credit_refund",
			relatedTransactionId: original.id,
			stripePaymentIntentId: original.stripePaymentIntentId,
			amount: "10.01",
			creditAmount: "0",
		});
		await payment("canonical-refund", {
			type: "subscription_refund",
			relatedTransactionId: original.id,
			stripePaymentIntentId:
				field === "paymentIntent"
					? `${org}-other-pi`
					: original.stripePaymentIntentId,
			stripeRefundId: `${org}-canonical`,
			currency: field === "currency" ? "EUR" : "USD",
			amount: "10.01",
			creditAmount: "0",
		});
		addRefund("canonical", original.stripePaymentIntentId!);
		const before = await ledgerSnapshot();
		await expect(
			legacyPass(stripe, true, original.stripePaymentIntentId!),
		).rejects.toThrow("Conflicting existing refund");
		expect(await ledgerSnapshot()).toEqual(before);
	},
);
let refundPaymentIntentOverride: string | undefined;
function refundPage(rows: typeof refunds, start: number) {
	return rows.slice(start, start + 1).map((row) => ({
		...row,
		payment_intent: refundPaymentIntentOverride ?? row.payment_intent,
	}));
}

test.each([false, true])(
	"actual CLI rejects succeeded evidence belonging to another PI (commit=%s)",
	async (commit) => {
		const original = await payment("wrong-evidence-original");
		await payment("wrong-evidence-legacy", {
			type: "credit_refund",
			relatedTransactionId: original.id,
			stripePaymentIntentId: original.stripePaymentIntentId,
			amount: "10.01",
			creditAmount: "0",
		});
		addRefund("wrong-evidence", original.stripePaymentIntentId!);
		const before = await ledgerSnapshot();
		refundPaymentIntentOverride = `${org}-other-pi`;
		try {
			const result = await runBackfillCLI(
				original.stripePaymentIntentId!,
				commit,
			);
			expect(await ledgerSnapshot()).toEqual(before);
			expect(result.stdout).toContain("0 legacy row(s) planned for deletion");
		} finally {
			refundPaymentIntentOverride = undefined;
		}
	},
);

test("unscoped passes cannot combine evidence from different payment intents", async () => {
	for (const [id, cents] of [
		["first", 1000],
		["second", 5000],
	] as const) {
		const original = await payment(`${id}-original`, { amount: "100" });
		await payment(`${id}-legacy`, {
			type: "credit_refund",
			relatedTransactionId: original.id,
			stripePaymentIntentId: original.stripePaymentIntentId,
			amount: "60",
			creditAmount: "0",
		});
		addRefund(id, original.stripePaymentIntentId!, cents);
	}
	const before = await ledgerSnapshot();
	for (const commit of [false, true]) {
		await legacyPass(stripe, commit, undefined);
		await sweepPass(stripe, commit, undefined);
		expect(await ledgerSnapshot()).toEqual(before);
	}
});
