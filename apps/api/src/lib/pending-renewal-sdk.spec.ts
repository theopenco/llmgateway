import { createServer } from "node:http";

import Stripe from "stripe";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";

import { getDevPlanTierFromInvoice } from "@/utils/dev-plan-prices.js";

import { repriceDraftRenewalInvoice } from "./pending-renewal.js";

import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => ({ client: undefined as Stripe | undefined }));
vi.mock("@/routes/payments.js", () => ({ getStripe: () => state.client }));

let invoice: Stripe.Invoice;
let listPages = false;
let linePages = false;
let loseResponse = false;
let finalizeBeforeWrite = false;
let writes: { key: string; amount: number; price: string }[];
let requests: string[];
const keys = new Set<string>();
const args = {
	subscriptionId: "sub_fixture",
	customer: "cus_fixture",
	newPriceId: "price_lite",
	newTier: "lite",
};
function planLine(amount = 7900): Stripe.InvoiceLineItem {
	return {
		id: "il_plan",
		amount,
		quantity: 1,
		parent: {
			type: "subscription_item_details",
			subscription_item_details: {
				proration: false,
				subscription: "sub_fixture",
			},
		},
		pricing: { price_details: { price: "price_pro" } },
		metadata: {},
	} as unknown as Stripe.InvoiceLineItem;
}
function adjustment(amount: number): Stripe.InvoiceLineItem {
	return {
		id: `il_adjust_${writes.length}`,
		amount,
		parent: { type: "invoice_item_details" },
		metadata: { devPlanRenewalReprice: "true" },
	} as unknown as Stripe.InvoiceLineItem;
}
const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	requests.push(`${req.method} ${url.pathname}${url.search}`);
	res.setHeader("Content-Type", "application/json");
	if (url.pathname.startsWith("/v1/prices/")) {
		const id = url.pathname.split("/").at(-1);
		res.end(
			JSON.stringify({
				id,
				object: "price",
				unit_amount: id === "price_lite" ? 2900 : 7900,
				currency: "usd",
				livemode: false,
			}),
		);
	} else if (req.method === "GET" && url.pathname === "/v1/invoices") {
		expect(url.searchParams.get("subscription")).toBe("sub_fixture");
		expect(url.searchParams.get("status")).toBe("draft");
		const first = listPages && !url.searchParams.has("starting_after");
		res.end(
			JSON.stringify({
				object: "list",
				has_more: first,
				data: first
					? [{ ...invoice, id: "in_manual", billing_reason: "manual" }]
					: [invoice],
			}),
		);
	} else if (req.method === "GET" && url.pathname.endsWith("/lines")) {
		res.end(
			JSON.stringify({
				object: "list",
				has_more: false,
				data: linePages ? [adjustment(-5000)] : [],
			}),
		);
	} else if (
		req.method === "POST" &&
		url.pathname === "/v1/invoices/in_fixture/add_lines"
	) {
		let body = "";
		for await (const chunk of req) {
			body += String(chunk);
		}
		const form = new URLSearchParams(body);
		const key = String(req.headers["idempotency-key"]);
		if (finalizeBeforeWrite || invoice.status !== "draft") {
			res.statusCode = 400;
			res.end(
				JSON.stringify({
					error: {
						type: "invalid_request_error",
						message: "Invoice is no longer draft",
					},
				}),
			);
			return;
		}
		const amount = Number(form.get("lines[0][amount]"));
		const price = form.get("invoice_metadata[devPlanRenewalPriceId]") ?? "";
		expect(form.get("lines[0][metadata][devPlanRenewalReprice]")).toBe("true");
		if (!keys.has(key)) {
			keys.add(key);
			writes.push({ key, amount, price });
			invoice.lines.data.push(adjustment(amount));
			invoice.metadata = { devPlanRenewalPriceId: price };
		}
		if (loseResponse) {
			loseResponse = false;
			req.socket.destroy();
			return;
		}
		res.end(JSON.stringify(invoice));
	} else {
		res.statusCode = 404;
		res.end(
			JSON.stringify({ error: { message: "Unexpected fixture request" } }),
		);
	}
});

beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	state.client = new Stripe("sk_test_fixture", {
		host: "127.0.0.1",
		port: (server.address() as AddressInfo).port,
		protocol: "http",
		maxNetworkRetries: 0,
	});
});
afterAll(async () => {
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	vi.unstubAllEnvs();
});
beforeEach(() => {
	vi.stubEnv("STRIPE_DEV_PLAN_PRO_PRICE_ID", "price_pro");
	vi.stubEnv("STRIPE_DEV_PLAN_LITE_PRICE_ID", "price_lite");
	writes = [];
	requests = [];
	keys.clear();
	listPages = false;
	linePages = false;
	loseResponse = false;
	finalizeBeforeWrite = false;
	invoice = {
		id: "in_fixture",
		object: "invoice",
		status: "draft",
		billing_reason: "subscription_cycle",
		customer: "cus_fixture",
		currency: "usd",
		metadata: {},
		lines: { data: [planLine()], has_more: false },
	} as unknown as Stripe.Invoice;
});

describe("draft renewal reprice through real Stripe SDK loopback", () => {
	test("writes adjustment and entitlement price atomically and allows distinct repeat reprices", async () => {
		await repriceDraftRenewalInvoice(args);
		expect(writes.map((x) => x.amount)).toEqual([-5000]);
		expect(getDevPlanTierFromInvoice(invoice)).toBe("lite");
		await repriceDraftRenewalInvoice(args);
		expect(writes).toHaveLength(1);
		await repriceDraftRenewalInvoice({
			...args,
			newPriceId: "price_pro",
			newTier: "pro",
		});
		expect(getDevPlanTierFromInvoice(invoice)).toBe("pro");
		await repriceDraftRenewalInvoice(args);
		expect(writes.map((x) => x.amount)).toEqual([-5000, 5000, -5000]);
		expect(new Set(writes.map((x) => x.key)).size).toBe(3);
		expect(invoice.lines.data.reduce((sum, line) => sum + line.amount, 0)).toBe(
			2900,
		);
	});
	test("coalesces duplicate same-state attempts", async () => {
		await Promise.all([
			repriceDraftRenewalInvoice(args),
			repriceDraftRenewalInvoice(args),
		]);
		expect(writes).toHaveLength(1);
	});
	test("recovers after remote success and a lost response without adding the delta twice", async () => {
		loseResponse = true;
		await repriceDraftRenewalInvoice(args);
		await repriceDraftRenewalInvoice(args);
		expect(writes).toHaveLength(1);
		expect(getDevPlanTierFromInvoice(invoice)).toBe("lite");
	});
	test("reads later invoice and line pages before netting", async () => {
		listPages = true;
		linePages = true;
		invoice.lines.has_more = true;
		await repriceDraftRenewalInvoice({
			...args,
			newPriceId: "price_pro",
			newTier: "pro",
		});
		expect(writes.map((x) => x.amount)).toEqual([5000]);
		expect(requests.some((x) => x.includes("starting_after=in_manual"))).toBe(
			true,
		);
		expect(requests.some((x) => x.includes("starting_after=il_plan"))).toBe(
			true,
		);
	});
	test.each(["paid", "void", "open", "uncollectible"] as const)(
		"never adjusts a %s invoice",
		async (status) => {
			invoice.status = status;
			await repriceDraftRenewalInvoice(args);
			expect(writes).toHaveLength(0);
		},
	);
	test("rejects another customer's draft", async () => {
		invoice.customer = "cus_other";
		await repriceDraftRenewalInvoice(args);
		expect(writes).toHaveLength(0);
	});
	test("keeps both amount and marker unchanged when finalization races the write", async () => {
		finalizeBeforeWrite = true;
		await repriceDraftRenewalInvoice(args);
		expect(writes).toHaveLength(0);
		expect(getDevPlanTierFromInvoice(invoice)).toBe("pro");
	});
	test("does not treat a proration or discount as a full-price cycle", async () => {
		invoice.lines.data[0].parent!.subscription_item_details!.proration = true;
		await repriceDraftRenewalInvoice(args);
		expect(writes).toHaveLength(0);
		invoice.lines.data[0].parent!.subscription_item_details!.proration = false;
		invoice.discounts = ["di_fixture"];
		await repriceDraftRenewalInvoice(args);
		expect(writes).toHaveLength(0);
	});
	test("does not adjust a draft with another currency", async () => {
		invoice.currency = "eur";
		await repriceDraftRenewalInvoice(args);
		expect(writes).toHaveLength(0);
	});
	test("does not override a known original price with unknown marker metadata", () => {
		invoice.metadata = { devPlanRenewalPriceId: "price_unknown" };
		expect(getDevPlanTierFromInvoice(invoice)).toBe("pro");
	});
});
