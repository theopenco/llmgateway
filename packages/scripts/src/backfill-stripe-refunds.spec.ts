import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { legacyPass, sweepPass } from "./backfill-stripe-refunds.js";

let org: string;
let stripe: Stripe;
let server: ReturnType<typeof createServer>;
let refunds: { id: string; payment_intent: string; amount: number; status: string; created: number }[];
let invoiceByPI: Record<string, string>;
let requests: string[];

beforeEach(async () => {
	org = randomUUID();
	refunds = [];
	invoiceByPI = {};
	requests = [];
	await db.insert(tables.organization).values({ id: org, name: "Test Organization", kind: "devpass", credits: "12.34", devPlan: "pro" });
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
			res.end(JSON.stringify({ object: "list", data: rows.slice(start, start + 1), has_more: start + 1 < rows.length, url: "/v1/refunds" }));
			return;
		}
		if (url.pathname === "/v1/invoice_payments") {
			const pi = url.searchParams.get("payment[payment_intent]") ?? "";
			res.end(JSON.stringify({ object: "list", data: invoiceByPI[pi] ? [{ invoice: invoiceByPI[pi] }] : [], has_more: false, url: "/v1/invoice_payments" }));
			return;
		}
		res.writeHead(404);
		res.end(JSON.stringify({ error: { message: "Unexpected fixture endpoint" } }));
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") { throw new Error("No fixture port"); }
	stripe = new Stripe(["sk", "test", "fixture"].join("_"), { apiVersion: "2025-04-30.basil", host: "127.0.0.1", port: address.port, protocol: "http", maxNetworkRetries: 0 });
});

afterEach(async () => {
	await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
	await db.delete(tables.transaction).where(eq(tables.transaction.organizationId, org));
	await db.delete(tables.organization).where(eq(tables.organization.id, org));
});

async function payment(id: string, overrides: Partial<typeof tables.transaction.$inferInsert> = {}) {
	const [row] = await db.insert(tables.transaction).values({ id: `${org}-${id}`, organizationId: org, type: "dev_plan_start", amount: "29.01", creditAmount: "87", status: "completed", stripePaymentIntentId: `${org}-${id}`, ...overrides }).returning();
	return row;
}

function addRefund(id: string, pi: string, amount = 1001, status = "succeeded") {
	refunds.push({ id: `${org}-${id}`, payment_intent: pi, amount, status, created: 1750000000 });
}

async function checkSweep() {
	const original = await payment("invoice", { stripePaymentIntentId: null, stripeInvoiceId: `${org}-invoice` });
	invoiceByPI[`${org}-pi`] = `${org}-invoice`;
	addRefund("one", `${org}-pi`);
	addRefund("two", `${org}-pi`, 29);
	addRefund("pending", `${org}-pi`, 10, "pending");
	await Promise.all([sweepPass(stripe, true, undefined), sweepPass(stripe, true, undefined)]);
	await sweepPass(stripe, true, undefined);
	const rows = await db.query.transaction.findMany({ where: { organizationId: { eq: org }, type: { eq: "subscription_refund" } }, orderBy: { amount: "asc" } });
	expect(rows.map((row) => row.amount)).toEqual(["0.29", "10.01"]);
	expect(rows.every((row) => row.creditAmount === "0" && row.relatedTransactionId === original.id)).toBe(true);
	expect(requests.some((url) => url.includes("starting_after="))).toBe(true);
	expect(requests.every((url) => url.startsWith("GET "))).toBe(true);
	expect((await db.query.organization.findFirst({ where: { id: { eq: org } } }))?.credits).toBe("12.34");
}

async function checkSideEffects() {
	for (const type of ["credit_topup", "dev_plan_reset_pass"] as const) {
		const original = await payment(type, { type });
		addRefund(type, original.stripePaymentIntentId!);
	}
	const covered = await payment("covered");
	addRefund("covered", covered.stripePaymentIntentId!);
	await payment("legacy", { type: "credit_refund", stripePaymentIntentId: covered.stripePaymentIntentId, relatedTransactionId: covered.id, creditAmount: "0" });
	await sweepPass(stripe, true, undefined);
	expect(await db.query.transaction.findMany({ where: { organizationId: { eq: org }, type: { eq: "subscription_refund" } } })).toHaveLength(0);
}

async function checkLegacy() {
	const original = await payment("original");
	await payment("legacy", { type: "credit_refund", stripePaymentIntentId: original.stripePaymentIntentId, relatedTransactionId: original.id, amount: "20.02", creditAmount: "0" });
	addRefund("one", original.stripePaymentIntentId!);
	addRefund("two", original.stripePaymentIntentId!);
	await legacyPass(stripe, true, original.stripePaymentIntentId!);
	await legacyPass(stripe, true, original.stripePaymentIntentId!);
	expect(await db.query.transaction.findMany({ where: { organizationId: { eq: org }, type: { eq: "subscription_refund" } } })).toHaveLength(2);
	expect(await db.query.transaction.findFirst({ where: { id: { eq: `${org}-legacy` } } })).toBeUndefined();
}

describe("refund backfill with isolated PostgreSQL and Stripe SDK loopback", () => {
	test("paginates exact invoice linkage and concurrent duplicate deliveries without credit mutations", checkSweep);
	test("leaves top-up, Reset Pass and legacy-covered misses for manual review", checkSideEffects);
	test("replaces cumulative legacy rows once using individual succeeded refunds", checkLegacy);
});
