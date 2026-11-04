import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";

import { db, eq, inArray, tables } from "@llmgateway/db";

function registerRefundTests() {
	interface Refund {
		id: string;
		object: "refund";
		amount: number;
		created: number;
		currency: string;
		payment_intent: string;
		status: string;
		reason: null;
	}

	const root = fileURLToPath(new URL("../../../", import.meta.url));
	const refunds = new Map<string, Refund[]>();
	const invoices = new Map<string, string[]>();
	const failures = new Set<string>();
	const requests: URL[] = [];
	const orgIds: string[] = [];
	let server: Server;
	let port: number;
	let org: string;

	function refund(pi: string, id: string, amount = 101): Refund {
		return {
			id,
			object: "refund",
			amount,
			created: 1770000000,
			currency: "usd",
			payment_intent: pi,
			status: "succeeded",
			reason: null,
		};
	}

	async function organization(
		kind: "devpass" | "default" | "chat" = "devpass",
	): Promise<string> {
		const id = `refund-fixture-${randomUUID()}`;
		orgIds.push(id);
		await db.insert(tables.organization).values({
			id,
			name: "Test Organization",
			billingEmail: "admin@example.com",
			kind,
			credits: "31.25",
			devPlan: "pro",
			devPlanResetPassesPro: 2,
		});
		return id;
	}

	async function original(
		values: Partial<typeof tables.transaction.$inferInsert> = {},
	) {
		const [row] = await db
			.insert(tables.transaction)
			.values({
				organizationId: org,
				type: "dev_plan_renewal",
				amount: "20.20",
				status: "completed",
				...values,
			})
			.returning();
		return row;
	}

	function cli(args: string[]) {
		return new Promise<{ code: number | null; output: string }>(
			(resolve, reject) => {
				const child = spawn(
					process.execPath,
					[
						"--import",
						"tsx",
						"--import",
						"./packages/scripts/src/test-utils/stripe-refund-loopback.ts",
						"packages/scripts/src/backfill-stripe-refunds.ts",
						...args,
					],
					{
						cwd: root,
						env: {
							...process.env,
							DATABASE_URL: process.env.DATABASE_URL,
							STRIPE_SECRET_KEY: ["sk", "test", "refund_fixture"].join("_"),
							REFUND_BACKFILL_TEST_PORT: String(port),
						},
						stdio: ["ignore", "pipe", "pipe"],
					},
				);
				let output = "";
				child.stdout.on("data", (data: Buffer) => {
					output += data.toString();
				});
				child.stderr.on("data", (data: Buffer) => {
					output += data.toString();
				});
				child.on("error", reject);
				child.on("exit", (code) => resolve({ code, output }));
			},
		);
	}

	async function rows() {
		return await db
			.select()
			.from(tables.transaction)
			.where(eq(tables.transaction.organizationId, org))
			.orderBy(tables.transaction.id);
	}

	beforeAll(async () => {
		const url = new URL(process.env.DATABASE_URL ?? "");
		if (
			!["localhost", "127.0.0.1"].includes(url.hostname) ||
			!url.pathname.includes("test")
		) {
			throw new Error(
				"Refund CLI tests require an isolated local test database",
			);
		}
		server = createServer((request, response) => {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			requests.push(url);
			response.setHeader("content-type", "application/json");
			if (request.method !== "GET") {
				response.writeHead(405).end(
					JSON.stringify({
						error: {
							message: "Stripe writes forbidden",
							type: "invalid_request_error",
						},
					}),
				);
				return;
			}
			const pi = url.searchParams.get("payment_intent") ?? "";
			const invoice = url.searchParams.get("invoice") ?? "";
			if (failures.has(pi) || failures.has(invoice)) {
				response.writeHead(400).end(
					JSON.stringify({
						error: {
							message: "fixture read failure",
							type: "invalid_request_error",
						},
					}),
				);
				return;
			}
			const data =
				url.pathname === "/v1/refunds"
					? (refunds.get(pi) ?? [])
					: url.pathname === "/v1/invoice_payments"
						? invoicePayments(
								invoice,
								url.searchParams.get("payment[payment_intent]"),
							)
						: undefined;
			if (!data) {
				response.writeHead(404).end(
					JSON.stringify({
						error: {
							message: "Unexpected fixture route",
							type: "invalid_request_error",
						},
					}),
				);
				return;
			}
			const after = url.searchParams.get("starting_after");
			const start = after ? data.findIndex((item) => item.id === after) + 1 : 0;
			response.end(
				JSON.stringify({
					object: "list",
					url: url.pathname,
					data: data.slice(start, start + 1),
					has_more: start + 1 < data.length,
				}),
			);
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("No fixture listener");
		}
		port = address.port;
	});

	beforeEach(async () => {
		refunds.clear();
		invoices.clear();
		failures.clear();
		requests.length = 0;
		org = await organization();
	});

	afterEach(async () => {
		await db
			.delete(tables.organization)
			.where(inArray(tables.organization.id, orgIds));
		orgIds.length = 0;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	});

	function registerBackfillCases() {
		describe("refund backfill actual CLI and Stripe SDK", () => {
			it.each([
				["--commmit"],
				["--commit", "--org="],
				["--org"],
				["--org=a", "--org=b"],
				["--payment-intent="],
				["--commit=true"],
				["unexpected"],
			])("rejects invalid arguments before reads: %j", async (...args) => {
				const result = await cli(args);
				expect(result.code, result.output).not.toBe(0);
				expect(requests).toHaveLength(0);
				expect(await rows()).toHaveLength(0);
			});

			it("dry-runs, applies scoped refunds with invoice/refund pagination, then repeats without writes", async () => {
				const payment = await original({ stripeInvoiceId: "in_fixture_paged" });
				const other = await organization();
				await original({
					organizationId: other,
					stripePaymentIntentId: "pi_other",
				});
				invoices.set("in_fixture_paged", ["pi_fixture_1", "pi_fixture_2"]);
				refunds.set("pi_fixture_1", [
					refund("pi_fixture_1", "re_fixture_1"),
					{ ...refund("pi_fixture_1", "re_failed"), status: "failed" },
					refund("pi_fixture_1", "re_fixture_2", 202),
				]);
				refunds.set("pi_fixture_2", [
					refund("pi_fixture_2", "re_fixture_3", 303),
				]);
				refunds.set("pi_other", [refund("pi_other", "re_other")]);
				const beforeOrg = await db.query.organization.findFirst({
					where: { id: { eq: org } },
				});
				expect((await cli([`--org=${org}`])).code).toBe(0);
				expect(await rows()).toEqual([payment]);
				const applied = await cli(["--commit", `--org=${org}`]);
				expect(applied.code, applied.output).toBe(0);
				const stored = (await rows()).filter((row) => row.stripeRefundId);
				expect(stored.map((row) => row.stripeRefundId).sort()).toEqual([
					"re_fixture_1",
					"re_fixture_2",
					"re_fixture_3",
				]);
				for (const row of stored) {
					expect(row).toMatchObject({
						organizationId: org,
						relatedTransactionId: payment.id,
						type: "credit_refund",
						creditAmount: "0",
						currency: "USD",
						status: "completed",
						createdAt: new Date(1770000000000),
					});
				}
				expect(stored.map((row) => row.amount).sort()).toEqual([
					"1.01",
					"2.02",
					"3.03",
				]);
				expect(
					await db.query.organization.findFirst({ where: { id: { eq: org } } }),
				).toEqual(beforeOrg);
				expect(
					await db.query.transaction.findFirst({
						where: { id: { eq: payment.id } },
					}),
				).toEqual(payment);
				expect(
					requests.some(
						(url) =>
							url.pathname === "/v1/invoice_payments" &&
							url.searchParams.has("starting_after"),
					),
				).toBe(true);
				expect(
					requests.some(
						(url) =>
							url.pathname === "/v1/refunds" &&
							url.searchParams.has("starting_after"),
					),
				).toBe(true);
				expect(
					requests.some(
						(url) => url.searchParams.get("payment_intent") === "pi_other",
					),
				).toBe(false);
				const beforeRepeat = await rows();
				expect((await cli(["--commit", `--org=${org}`])).code).toBe(0);
				expect(await rows()).toEqual(beforeRepeat);
			});

			it.each([
				"dev_plan_start",
				"dev_plan_upgrade",
				"subscription_start",
			] as const)(
				"discovers %s without changing entitlements",
				async (type) => {
					const payment = await original({
						type,
						stripePaymentIntentId: "pi_kind",
					});
					refunds.set("pi_kind", [refund("pi_kind", "re_kind")]);
					const before = await db.query.organization.findFirst({
						where: { id: { eq: org } },
					});
					const result = await cli(["--commit", `--org=${org}`]);
					expect(result.code, result.output).toBe(0);
					expect(
						(await rows()).find((row) => row.stripeRefundId === "re_kind")
							?.relatedTransactionId,
					).toBe(payment.id);
					expect(
						await db.query.organization.findFirst({
							where: { id: { eq: org } },
						}),
					).toEqual(before);
				},
			);

			it("reconciles cumulative legacy rows atomically and does not duplicate existing refunds", async () => {
				const payment = await original({ stripePaymentIntentId: "pi_legacy" });
				await original({
					type: "credit_refund",
					amount: "1.01",
					relatedTransactionId: payment.id,
					stripePaymentIntentId: "pi_legacy",
				});
				await original({
					type: "credit_refund",
					amount: "3.03",
					relatedTransactionId: payment.id,
					stripePaymentIntentId: "pi_legacy",
				});
				await original({
					type: "credit_refund",
					amount: "1.01",
					creditAmount: "0",
					relatedTransactionId: payment.id,
					stripePaymentIntentId: "pi_legacy",
					stripeRefundId: "re_legacy_1",
				});
				refunds.set("pi_legacy", [
					refund("pi_legacy", "re_legacy_1"),
					refund("pi_legacy", "re_legacy_2", 202),
				]);
				expect((await cli([`--org=${org}`])).code).toBe(0);
				expect(await rows()).toHaveLength(4);
				const results = await Promise.all([
					cli(["--commit", `--org=${org}`]),
					cli(["--commit", `--org=${org}`]),
				]);
				for (const result of results) {
					expect(result.code, result.output).toBe(0);
				}
				expect(
					(await rows())
						.map((row) => row.stripeRefundId)
						.filter(Boolean)
						.sort(),
				).toEqual(["re_legacy_1", "re_legacy_2"]);
				expect(await rows()).toHaveLength(3);
			});

			it("concurrent missing-refund applies both succeed and insert each refund once", async () => {
				await original({ stripePaymentIntentId: "pi_concurrent" });
				refunds.set(
					"pi_concurrent",
					Array.from({ length: 8 }, (_, i) =>
						refund("pi_concurrent", `re_concurrent_${i}`),
					),
				);
				const results = await Promise.all([
					cli(["--commit", `--org=${org}`]),
					cli(["--commit", `--org=${org}`]),
				]);
				for (const result of results) {
					expect(result.code, result.output).toBe(0);
				}
				expect(await rows()).toHaveLength(9);
			});

			it("does not turn a malformed cross-org legacy link into an out-of-scope write", async () => {
				const other = await organization();
				const payment = await original({
					organizationId: other,
					stripePaymentIntentId: "pi_cross_org",
				});
				await original({
					type: "credit_refund",
					relatedTransactionId: payment.id,
					stripePaymentIntentId: "pi_cross_org",
				});
				refunds.set("pi_cross_org", [refund("pi_cross_org", "re_cross_org")]);
				const result = await cli(["--commit", `--org=${org}`]);
				expect(result.code).not.toBe(0);
				expect(await rows()).toHaveLength(1);
				expect(
					await db.query.transaction.findFirst({
						where: { stripeRefundId: { eq: "re_cross_org" } },
					}),
				).toBeUndefined();
			});

			it("does not invent a missing legacy original", async () => {
				await original({
					type: "credit_refund",
					relatedTransactionId: "missing-fixture-original",
					stripePaymentIntentId: "pi_orphan",
				});
				refunds.set("pi_orphan", [refund("pi_orphan", "re_orphan")]);
				const result = await cli(["--commit", `--org=${org}`]);
				expect(result.code).not.toBe(0);
				expect(await rows()).toHaveLength(1);
				expect((await rows())[0].stripeRefundId).toBeNull();
			});

			it("reports incomplete Stripe reads even when phase 1 has only non-DevPass rows", async () => {
				const topup = await original({
					type: "credit_topup",
					stripePaymentIntentId: "pi_topup",
				});
				await original({
					type: "credit_refund",
					relatedTransactionId: topup.id,
					stripePaymentIntentId: "pi_topup",
				});
				await original({ stripeInvoiceId: "in_failure" });
				failures.add("in_failure");
				const result = await cli([`--org=${org}`]);
				expect(result.code, result.output).not.toBe(0);
				expect(result.output).toContain("INCOMPLETE");
			});

			it("respects PI scope and ignores top-ups, marker rows, pending payments and other org kinds", async () => {
				await original({ stripePaymentIntentId: "pi_selected" });
				await original({ stripePaymentIntentId: "pi_unselected" });
				await original({
					type: "credit_topup",
					stripePaymentIntentId: "pi_topup",
				});
				await original({
					type: "dev_plan_cancel",
					stripePaymentIntentId: "pi_marker",
				});
				await original({
					status: "pending",
					stripePaymentIntentId: "pi_pending",
				});
				const other = await organization("default");
				await original({
					organizationId: other,
					type: "subscription_start",
					stripePaymentIntentId: "pi_default",
				});
				refunds.set("pi_selected", [refund("pi_selected", "re_selected")]);
				const result = await cli([
					"--commit",
					`--org=${org}`,
					"--payment-intent=pi_selected",
				]);
				expect(result.code, result.output).toBe(0);
				expect(
					requests
						.filter((url) => url.pathname === "/v1/refunds")
						.map((url) => url.searchParams.get("payment_intent")),
				).toEqual(["pi_selected"]);
				expect((await rows()).filter((row) => row.stripeRefundId)).toHaveLength(
					1,
				);
			});
		});

		describe("refund source integrity", () => {
			it("blocks legacy rows whose PI disagrees with their original", async () => {
				const payment = await original({ stripePaymentIntentId: "pi_true" });
				await original({
					type: "credit_refund",
					relatedTransactionId: payment.id,
					stripePaymentIntentId: "pi_wrong",
					amount: "1.01",
				});
				refunds.set("pi_wrong", [refund("pi_wrong", "re_wrong")]);
				refunds.set("pi_true", [refund("pi_true", "re_true")]);
				const result = await cli(["--commit", `--org=${org}`]);
				expect(result.code, result.output).not.toBe(0);
				expect(await rows()).toHaveLength(2);
				expect((await rows()).some((row) => row.stripeRefundId)).toBe(false);
			});

			it("preserves unlinked legacy rows instead of duplicating them from an invoice source", async () => {
				const payment = await original({ stripeInvoiceId: "in_missing_pi" });
				await original({
					type: "credit_refund",
					relatedTransactionId: payment.id,
					amount: "1.01",
				});
				invoices.set("in_missing_pi", ["pi_missing_legacy_pi"]);
				refunds.set("pi_missing_legacy_pi", [
					refund("pi_missing_legacy_pi", "re_missing_legacy_pi"),
				]);
				const result = await cli(["--commit", `--org=${org}`]);
				expect(result.code, result.output).not.toBe(0);
				expect(await rows()).toHaveLength(2);
			});

			it("rejects global refund-ID collisions without deleting legacy evidence", async () => {
				const payment = await original({
					stripePaymentIntentId: "pi_collision",
				});
				await original({
					type: "credit_refund",
					relatedTransactionId: payment.id,
					stripePaymentIntentId: "pi_collision",
					amount: "1.01",
				});
				const other = await organization();
				const otherPayment = await original({
					organizationId: other,
					stripePaymentIntentId: "pi_other_collision",
				});
				await original({
					organizationId: other,
					type: "credit_refund",
					relatedTransactionId: otherPayment.id,
					stripePaymentIntentId: "pi_other_collision",
					stripeRefundId: "re_collision",
					amount: "1.01",
				});
				refunds.set("pi_collision", [refund("pi_collision", "re_collision")]);
				const before = await rows();
				const result = await cli(["--commit", `--org=${org}`]);
				expect(result.code, result.output).not.toBe(0);
				expect(await rows()).toEqual(before);
			});

			it("does not choose an arbitrary original when a PI has two sources", async () => {
				await original({ stripePaymentIntentId: "pi_ambiguous" });
				await original({ stripePaymentIntentId: "pi_ambiguous" });
				refunds.set("pi_ambiguous", [refund("pi_ambiguous", "re_ambiguous")]);
				const result = await cli(["--commit", `--org=${org}`]);
				expect(result.code, result.output).not.toBe(0);
				expect(await rows()).toHaveLength(2);
			});
		});

		describe("missing-history financial safety", () => {
			it("does not mask cancellation by backfilling a refund for an active plan", async () => {
				await db
					.update(tables.organization)
					.set({ devPlanStripeSubscriptionId: "sub_fixture_active" })
					.where(eq(tables.organization.id, org));
				await original({ stripePaymentIntentId: "pi_active" });
				refunds.set("pi_active", [refund("pi_active", "re_active", 2020)]);
				const result = await cli(["--commit", `--org=${org}`]);
				expect(result.code, result.output).not.toBe(0);
				expect(await rows()).toHaveLength(1);
			});

			it("leaves Reset Pass misses for manual inventory reconciliation", async () => {
				await original({
					type: "dev_plan_reset_pass",
					stripePaymentIntentId: "pi_reset_manual",
				});
				refunds.set("pi_reset_manual", [
					refund("pi_reset_manual", "re_reset_manual", 2020),
				]);
				const before = await db.query.organization.findFirst({
					where: { id: { eq: org } },
				});
				const result = await cli(["--commit", `--org=${org}`]);
				expect(result.code, result.output).not.toBe(0);
				expect(await rows()).toHaveLength(1);
				expect(
					await db.query.organization.findFirst({ where: { id: { eq: org } } }),
				).toEqual(before);
			});

			it.each(["overcap", "currency", "wrong-pi"])(
				"rejects %s Stripe evidence without deleting legacy rows",
				async (kind) => {
					const payment = await original({
						stripePaymentIntentId: "pi_invalid_evidence",
					});
					await original({
						type: "credit_refund",
						relatedTransactionId: payment.id,
						stripePaymentIntentId: "pi_invalid_evidence",
						amount: "1.01",
					});
					refunds.set("pi_invalid_evidence", [
						{
							...refund(
								"pi_invalid_evidence",
								"re_invalid_evidence",
								kind === "overcap" ? 2021 : 101,
							),
							...(kind === "currency" ? { currency: "eur" } : {}),
							...(kind === "wrong-pi"
								? { payment_intent: "pi_unrelated" }
								: {}),
						},
					]);
					const before = await rows();
					const result = await cli(["--commit", `--org=${org}`]);
					expect(result.code, result.output).not.toBe(0);
					expect(await rows()).toEqual(before);
				},
			);

			it("caps refunds across every payment intent on an invoice", async () => {
				await original({ stripeInvoiceId: "in_total_cap" });
				invoices.set("in_total_cap", ["pi_cap_a", "pi_cap_b"]);
				refunds.set("pi_cap_a", [refund("pi_cap_a", "re_cap_a", 1200)]);
				refunds.set("pi_cap_b", [refund("pi_cap_b", "re_cap_b", 1200)]);
				const result = await cli(["--commit", `--org=${org}`]);
				expect(result.code, result.output).not.toBe(0);
				expect(await rows()).toHaveLength(1);
			});
		});
	}
	registerBackfillCases();
	function invoicePayments(invoice: string, pi: string | null) {
		return [...invoices.entries()]
			.filter(([id]) => !invoice || id === invoice)
			.flatMap(([id, pis]) =>
				pis
					.filter((value) => !pi || value === pi)
					.map((value, index) => ({
						id: "inpay_" + id + "_" + index,
						object: "invoice_payment",
						invoice: id,
						status: "paid",
						payment: {
							type: "payment_intent",
							payment_intent: index % 2 ? { id: value } : value,
						},
					})),
			);
	}
	describe("source ownership cross-checks", () => {
		it("rejects a direct PI that does not belong to the stored invoice", async () => {
			await original({
				stripePaymentIntentId: "pi_wrong_invoice",
				stripeInvoiceId: "in_actual",
			});
			invoices.set("in_actual", ["pi_actual"]);
			refunds.set("pi_wrong_invoice", [
				refund("pi_wrong_invoice", "re_wrong_invoice"),
			]);
			expect((await cli(["--commit", "--org=" + org])).code).not.toBe(0);
			expect(await rows()).toHaveLength(1);
		});
		it("checks aggregate invoice refunds even when a direct PI is stored", async () => {
			await original({
				stripePaymentIntentId: "pi_both_a",
				stripeInvoiceId: "in_both",
			});
			invoices.set("in_both", ["pi_both_a", "pi_both_b"]);
			refunds.set("pi_both_a", [refund("pi_both_a", "re_both_a", 1200)]);
			refunds.set("pi_both_b", [refund("pi_both_b", "re_both_b", 1200)]);
			expect((await cli(["--commit", "--org=" + org])).code).not.toBe(0);
			expect(await rows()).toHaveLength(1);
		});
		it("detects another org invoice-only source of a scoped direct PI", async () => {
			await original({ stripePaymentIntentId: "pi_shared_invoice" });
			await original({
				organizationId: await organization(),
				stripeInvoiceId: "in_other_owner",
			});
			invoices.set("in_other_owner", ["pi_shared_invoice"]);
			refunds.set("pi_shared_invoice", [
				refund("pi_shared_invoice", "re_shared_invoice"),
			]);
			expect((await cli(["--commit", "--org=" + org])).code).not.toBe(0);
			expect(await rows()).toHaveLength(1);
		});
		it("does not attribute a top-up payment intent to a plan", async () => {
			await original({ stripePaymentIntentId: "pi_topup_collision" });
			await original({
				type: "credit_topup",
				stripePaymentIntentId: "pi_topup_collision",
			});
			refunds.set("pi_topup_collision", [
				refund("pi_topup_collision", "re_topup_collision"),
			]);
			expect((await cli(["--commit", "--org=" + org])).code).not.toBe(0);
			expect(await rows()).toHaveLength(2);
		});
		it("reports completed positive sources without recoverable Stripe identity", async () => {
			await original();
			const result = await cli(["--commit", "--org=" + org]);
			expect(result.code, result.output).not.toBe(0);
			expect(await rows()).toHaveLength(1);
		});
	});
	describe("other plan source isolation", () => {
		it.each([
			"chat_plan_start",
			"chat_plan_renewal",
			"chat_plan_upgrade",
		] as const)("does not steal a PI from another org's %s", async (type) => {
			await original({ stripePaymentIntentId: "pi_chat_collision" });
			await original({
				organizationId: await organization("chat"),
				type,
				stripePaymentIntentId: "pi_chat_collision",
			});
			refunds.set("pi_chat_collision", [
				refund("pi_chat_collision", "re_chat_collision"),
			]);
			const result = await cli(["--commit", "--org=" + org]);
			expect(result.code, result.output).not.toBe(0);
			expect(await rows()).toHaveLength(1);
		});
	});
	describe("unmatched recorded refund evidence", () => {
		it.each([true, false])(
			"retains all history when Stripe omits a recorded refund; legacy=%s",
			async (withLegacy) => {
				const payment = await original({
					stripePaymentIntentId: "pi_unknown_recorded",
				});
				await original({
					type: "credit_refund",
					amount: "1.01",
					creditAmount: "0",
					relatedTransactionId: payment.id,
					stripePaymentIntentId: "pi_unknown_recorded",
					stripeRefundId: "re_unknown_recorded",
				});
				if (withLegacy) {
					await original({
						type: "credit_refund",
						amount: "1.01",
						relatedTransactionId: payment.id,
						stripePaymentIntentId: "pi_unknown_recorded",
					});
				}
				refunds.set("pi_unknown_recorded", [
					refund("pi_unknown_recorded", "re_actual_recorded"),
				]);
				const before = await rows();
				const result = await cli(["--commit", "--org=" + org]);
				expect(result.code, result.output).not.toBe(0);
				expect(await rows()).toEqual(before);
			},
		);
	});
	it("preserves unlinked keyed refunds sharing the payment intent", async () => {
		await original({ stripePaymentIntentId: "pi_unlinked_keyed" });
		await original({
			type: "credit_refund",
			amount: "1.01",
			creditAmount: "0",
			stripePaymentIntentId: "pi_unlinked_keyed",
			stripeRefundId: "re_unlinked_keyed",
		});
		refunds.set("pi_unlinked_keyed", [
			refund("pi_unlinked_keyed", "re_new_unlinked_keyed"),
		]);
		const before = await rows();
		const result = await cli(["--commit", "--org=" + org]);
		expect(result.code, result.output).not.toBe(0);
		expect(await rows()).toEqual(before);
	});
	describe("legacy per-intent evidence coverage", () => {
		it.each([false, true])(
			"retains a legacy row above its own PI evidence; multiple PIs=%s",
			async (multiple) => {
				const payment = await original(
					multiple
						? { stripeInvoiceId: "in_legacy_coverage" }
						: { stripePaymentIntentId: "pi_legacy_coverage" },
				);
				if (multiple) {
					invoices.set("in_legacy_coverage", [
						"pi_legacy_coverage",
						"pi_other_coverage",
					]);
					refunds.set("pi_other_coverage", [
						refund("pi_other_coverage", "re_other_coverage", 1500),
					]);
				}
				await original({
					type: "credit_refund",
					amount: "15",
					relatedTransactionId: payment.id,
					stripePaymentIntentId: "pi_legacy_coverage",
				});
				refunds.set("pi_legacy_coverage", [
					refund("pi_legacy_coverage", "re_legacy_coverage", 100),
				]);
				const before = await rows();
				const dryRun = await cli(["--org=" + org]);
				expect(await rows()).toEqual(before);
				const applied = await cli(["--commit", "--org=" + org]);
				expect({
					dryRun: dryRun.code,
					apply: applied.code,
					rows: await rows(),
				}).toEqual({ dryRun: 1, apply: 1, rows: before });
			},
		);
	});
}
registerRefundTests();
