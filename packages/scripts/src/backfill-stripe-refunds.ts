/* eslint-disable no-console */
/** Historical DevPass refund ledger repair. Dry-run by default; never issues Stripe writes. */
import { Decimal } from "decimal.js";
import Stripe from "stripe";

import {
	and,
	db,
	eq,
	gt,
	inArray,
	isNull,
	or,
	tables,
	notInArray,
} from "@llmgateway/db";

import {
	centsToDollars,
	parseBackfillArgs,
	refundDescription,
	REFUNDABLE_ORIGINAL_TYPES,
} from "./lib/devpass-refund-backfill.js";

import type { TransactionRow } from "./lib/devpass-refund-backfill.js";

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];
const originalTypes = REFUNDABLE_ORIGINAL_TYPES;
const identity = (value: string | { id?: string } | null | undefined) =>
	typeof value === "string" ? value : value?.id;

function assertOriginal(row: TransactionRow) {
	if (
		!originalTypes.includes(row.type as (typeof originalTypes)[number]) ||
		row.status !== "completed" ||
		row.currency.toUpperCase() !== "USD" ||
		!new Decimal(row.amount ?? 0).gt(0)
	) {
		throw new Error("Source must be a completed positive USD plan payment");
	}
}

async function resolveInvoicePaymentIntents(stripe: Stripe, invoice: string) {
	const ids = new Set<string>();
	for await (const payment of stripe.invoicePayments.list({
		invoice,
		status: "paid",
		limit: 100,
	})) {
		if (identity(payment.invoice) !== invoice || payment.status !== "paid") {
			throw new Error("Invoice payment ownership/status mismatch");
		}
		if (payment.payment.type === "payment_intent") {
			const id = identity(payment.payment.payment_intent);
			if (!id) {
				throw new Error("Invoice payment has no payment intent");
			}
			ids.add(id);
		}
	}
	if (!ids.size) {
		throw new Error(
			"Invoice has no paid payment intents; manual reconciliation required",
		);
	}
	return [...ids];
}

async function listSucceededRefunds(stripe: Stripe, pi: string) {
	const refunds: Stripe.Refund[] = [];
	const seen = new Set<string>();
	for await (const refund of stripe.refunds.list({
		payment_intent: pi,
		limit: 100,
	})) {
		if (refund.status !== "succeeded") {
			continue;
		}
		if (
			!refund.id ||
			seen.has(refund.id) ||
			identity(refund.payment_intent) !== pi ||
			refund.currency !== "usd" ||
			!Number.isSafeInteger(refund.amount) ||
			refund.amount <= 0 ||
			!Number.isSafeInteger(refund.created) ||
			refund.created < 0
		) {
			throw new Error("Invalid, duplicate or unrelated Stripe refund evidence");
		}
		seen.add(refund.id);
		refunds.push(refund);
	}
	return refunds;
}

function assertRecorded(
	row: TransactionRow,
	original: TransactionRow,
	refund: Stripe.Refund,
) {
	if (
		row.organizationId !== original.organizationId ||
		row.relatedTransactionId !== original.id ||
		row.type !== "credit_refund" ||
		row.status !== "completed" ||
		row.currency.toUpperCase() !== "USD" ||
		row.stripePaymentIntentId !== identity(refund.payment_intent) ||
		!new Decimal(row.amount ?? 0).eq(centsToDollars(refund.amount)) ||
		!new Decimal(row.creditAmount ?? 0).isZero()
	) {
		throw new Error(
			"Recorded refund conflicts with its Stripe/source identity; manual reconciliation required",
		);
	}
}

async function insertRefundRow(
	tx: Executor,
	original: TransactionRow,
	refund: Stripe.Refund,
) {
	const inserted = await tx
		.insert(tables.transaction)
		.values({
			organizationId: original.organizationId,
			type: "credit_refund",
			status: "completed",
			amount: centsToDollars(refund.amount).toString(),
			creditAmount: "0",
			currency: "USD",
			stripePaymentIntentId: identity(refund.payment_intent),
			stripeRefundId: refund.id,
			relatedTransactionId: original.id,
			refundReason: refund.reason,
			description: refundDescription(
				centsToDollars(refund.amount),
				new Decimal(original.amount ?? 0),
			),
			createdAt: new Date(refund.created * 1000),
			updatedAt: new Date(refund.created * 1000),
		})
		.onConflictDoNothing()
		.returning();
	if (!inserted.length) {
		const [existing] = await tx
			.select()
			.from(tables.transaction)
			.where(eq(tables.transaction.stripeRefundId, refund.id));
		if (!existing) {
			throw new Error("Conflicting refund disappeared");
		}
		assertRecorded(existing, original, refund);
	}
	return inserted.length;
}

async function reconcileOriginal(
	original: TransactionRow,
	pis: string[],
	evidence: Stripe.Refund[],
	commit: boolean,
	scopePI?: string,
) {
	return await db.transaction(async (tx) => {
		// Both concurrent CLI passes re-read the ledger only after this common lock.
		const [organization] = await tx
			.select()
			.from(tables.organization)
			.where(eq(tables.organization.id, original.organizationId))
			.for("update");
		const [current] = await tx
			.select()
			.from(tables.transaction)
			.where(eq(tables.transaction.id, original.id))
			.for("update");
		if (!organization || organization.kind !== "devpass" || !current) {
			throw new Error(
				"Source organization/payment disappeared or changed kind",
			);
		}
		assertOriginal(current);
		if (
			current.organizationId !== original.organizationId ||
			current.stripeInvoiceId !== original.stripeInvoiceId ||
			current.stripePaymentIntentId !== original.stripePaymentIntentId ||
			current.amount !== original.amount
		) {
			throw new Error("Source changed after Stripe lookup; rerun dry-run");
		}
		const ledger = await tx
			.select()
			.from(tables.transaction)
			.where(
				or(
					eq(tables.transaction.relatedTransactionId, original.id),
					inArray(tables.transaction.stripePaymentIntentId, pis),
				),
			);
		const legacy = ledger.filter(
			(row) => row.type === "credit_refund" && !row.stripeRefundId,
		);
		for (const row of legacy) {
			if (
				row.organizationId !== original.organizationId ||
				row.relatedTransactionId !== original.id ||
				!row.stripePaymentIntentId ||
				!pis.includes(row.stripePaymentIntentId) ||
				row.status !== "completed" ||
				row.currency.toUpperCase() !== "USD" ||
				!new Decimal(row.amount ?? 0).gt(0) ||
				!new Decimal(row.creditAmount ?? 0).isZero()
			) {
				throw new Error(
					"Legacy source/PI/financial fields require manual reconciliation",
				);
			}
		}
		const total = evidence.reduce(
			(sum, refund) => sum.plus(centsToDollars(refund.amount)),
			new Decimal(0),
		);
		if (total.gt(new Decimal(current.amount ?? 0))) {
			throw new Error(
				"Stripe refunds exceed the original payment across its payment intents",
			);
		}
		const selected = evidence.filter(
			(refund) => !scopePI || identity(refund.payment_intent) === scopePI,
		);
		const selectedLegacy = legacy.filter(
			(row) => !scopePI || row.stripePaymentIntentId === scopePI,
		);
		for (const row of selectedLegacy) {
			if (
				!selected.some(
					(refund) =>
						identity(refund.payment_intent) === row.stripePaymentIntentId,
				)
			) {
				throw new Error(
					"No succeeded Stripe evidence for a legacy refund; retaining it",
				);
			}
		}
		const recorded = evidence.length
			? await tx
					.select()
					.from(tables.transaction)
					.where(
						inArray(
							tables.transaction.stripeRefundId,
							evidence.map((refund) => refund.id),
						),
					)
			: [];
		const recordedById = new Map(
			recorded.map((row) => [row.stripeRefundId, row]),
		);
		for (const refund of evidence) {
			const row = recordedById.get(refund.id);
			if (row) {
				assertRecorded(row, current, refund);
			}
		}
		const missing = selected.filter((refund) => !recordedById.has(refund.id));
		const knownIds = new Set(evidence.map((refund) => refund.id));
		if (
			ledger.some(
				(row) =>
					row.stripeRefundId &&
					!knownIds.has(row.stripeRefundId) &&
					row.status === "completed",
			)
		) {
			throw new Error(
				"Recorded refund is absent from Stripe evidence; manual reconciliation required",
			);
		}
		if (!missing.length && !selectedLegacy.length) {
			return { inserted: 0, deleted: 0 };
		}
		if (current.type === "dev_plan_reset_pass") {
			throw new Error(
				"Reset Pass refunds require manual inventory reconciliation before history repair",
			);
		}
		if (
			organization.devPlanStripeSubscriptionId ||
			organization.chatPlanStripeSubscriptionId ||
			organization.stripeSubscriptionId
		) {
			throw new Error(
				"Active subscription: reconcile cancellation/entitlements before recording historical refunds",
			);
		}
		console.log(
			"Plan: source=" +
				current.id +
				" org=" +
				current.organizationId +
				" delete=" +
				selectedLegacy.length +
				" insert=" +
				missing.length,
		);
		if (!commit) {
			return { inserted: missing.length, deleted: selectedLegacy.length };
		}
		let inserted = 0;
		for (const refund of missing) {
			inserted += await insertRefundRow(tx, current, refund);
		}
		if (selectedLegacy.length) {
			await tx.delete(tables.transaction).where(
				inArray(
					tables.transaction.id,
					selectedLegacy.map((row) => row.id),
				),
			);
		}
		return { inserted, deleted: selectedLegacy.length };
	});
}

async function main() {
	const opts = parseBackfillArgs(process.argv.slice(2));
	const scopePI = opts["payment-intent"];
	console.log(
		opts.commit ? "Mode: COMMIT (writes enabled)" : "Mode: DRY RUN (no writes)",
	);
	if (!process.env.STRIPE_SECRET_KEY) {
		throw new Error("STRIPE_SECRET_KEY is required");
	}
	const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
		apiVersion: "2025-04-30.basil",
	});
	const organizations = await db
		.select({ id: tables.organization.id })
		.from(tables.organization)
		.where(
			and(
				eq(tables.organization.kind, "devpass"),
				...(opts.org ? [eq(tables.organization.id, opts.org)] : []),
			),
		);
	if (!organizations.length) {
		if (opts.org) {
			throw new Error("No DevPass organization matches --org");
		}
		return;
	}
	const originals = await db
		.select()
		.from(tables.transaction)
		.where(
			and(
				inArray(
					tables.transaction.organizationId,
					organizations.map((org) => org.id),
				),
				inArray(tables.transaction.type, [...originalTypes]),
				eq(tables.transaction.status, "completed"),
				gt(tables.transaction.amount, "0"),
			),
		);
	const pisByOriginal = new Map<string, string[]>();
	const invoices = new Map<string, Promise<string[]>>();
	const owners = new Map<string, Set<string>>();
	const blocked = new Set<string>();
	let failures = 0;
	for (const original of originals) {
		if (
			scopePI &&
			original.stripePaymentIntentId &&
			!original.stripeInvoiceId &&
			original.stripePaymentIntentId !== scopePI
		) {
			continue;
		}
		try {
			assertOriginal(original);
			let pis: string[];
			if (original.stripeInvoiceId) {
				let lookup = invoices.get(original.stripeInvoiceId);
				if (!lookup) {
					lookup = resolveInvoicePaymentIntents(
						stripe,
						original.stripeInvoiceId,
					);
					invoices.set(original.stripeInvoiceId, lookup);
				}
				pis = await lookup;
				if (
					original.stripePaymentIntentId &&
					!pis.includes(original.stripePaymentIntentId)
				) {
					throw new Error(
						"Stored payment intent does not belong to the source invoice",
					);
				}
			} else if (original.stripePaymentIntentId) {
				pis = [original.stripePaymentIntentId];
			} else {
				throw new Error("Completed payment has no recoverable Stripe identity");
			}
			if (scopePI && !pis.includes(scopePI)) {
				continue;
			}
			pisByOriginal.set(original.id, pis);
			for (const pi of pis) {
				const ids = owners.get(pi) ?? new Set<string>();
				ids.add(original.id);
				owners.set(pi, ids);
			}
		} catch (error) {
			failures++;
			blocked.add(original.id);
			console.error("INCOMPLETE source=" + original.id, error);
		}
	}
	const legacy = await db
		.select()
		.from(tables.transaction)
		.where(
			and(
				inArray(
					tables.transaction.organizationId,
					organizations.map((org) => org.id),
				),
				eq(tables.transaction.type, "credit_refund"),
				isNull(tables.transaction.stripeRefundId),
				...(scopePI
					? [
							or(
								eq(tables.transaction.stripePaymentIntentId, scopePI),
								...(pisByOriginal.size
									? [
											inArray(tables.transaction.relatedTransactionId, [
												...pisByOriginal.keys(),
											]),
										]
									: []),
							),
						]
					: []),
			),
		);
	for (const row of legacy) {
		const original = row.relatedTransactionId
			? await db.query.transaction.findFirst({
					where: { id: { eq: row.relatedTransactionId } },
				})
			: undefined;
		if (
			original &&
			!(originalTypes as readonly string[]).includes(original.type)
		) {
			continue;
		}
		if (
			!original ||
			original.organizationId !== row.organizationId ||
			!row.stripePaymentIntentId ||
			!pisByOriginal.get(original.id)?.includes(row.stripePaymentIntentId)
		) {
			failures++;
			if (original) {
				blocked.add(original.id);
			}
			for (const owner of owners.get(row.stripePaymentIntentId ?? "") ?? []) {
				blocked.add(owner);
			}
			console.error(
				"INCOMPLETE legacy=" +
					row.id +
					": missing or mismatched source; evidence retained",
			);
		}
	}
	let inserted = 0;
	let deleted = 0;
	for (const original of originals) {
		const pis = pisByOriginal.get(original.id);
		if (!pis || blocked.has(original.id)) {
			continue;
		}
		try {
			const invoiceIds = new Set(
				original.stripeInvoiceId ? [original.stripeInvoiceId] : [],
			);
			for (const pi of pis) {
				for (const invoice of await resolvePaymentIntentInvoices(stripe, pi)) {
					invoiceIds.add(invoice);
				}
			}
			// Reverse Stripe lookup prevents a scope from concealing invoice-only owners.
			const competing = await db
				.select()
				.from(tables.transaction)
				.where(
					and(
						notInArray(tables.transaction.type, ["credit_refund"]),
						gt(tables.transaction.amount, "0"),
						or(
							inArray(tables.transaction.stripePaymentIntentId, pis),
							...(invoiceIds.size
								? [inArray(tables.transaction.stripeInvoiceId, [...invoiceIds])]
								: []),
						),
					),
				);
			if (
				pis.some((pi) => (owners.get(pi)?.size ?? 0) !== 1) ||
				competing.some((row) => row.id !== original.id)
			) {
				throw new Error(
					"Ambiguous payment/invoice source; manual attribution required",
				);
			}
			const evidence: Stripe.Refund[] = [];
			for (const pi of pis) {
				evidence.push(...(await listSucceededRefunds(stripe, pi)));
			}
			const result = await reconcileOriginal(
				original,
				pis,
				evidence,
				opts.commit ?? false,
				scopePI,
			);
			inserted += result.inserted;
			deleted += result.deleted;
		} catch (error) {
			failures++;
			console.error("INCOMPLETE source=" + original.id, error);
		}
	}
	console.log(
		"Summary: inserted=" +
			inserted +
			" deleted=" +
			deleted +
			" incomplete=" +
			failures,
	);
	if (failures) {
		process.exitCode = 1;
	}
}

main()
	.then(() => process.exit(process.exitCode ?? 0))
	.catch((error: unknown) => {
		console.error("INCOMPLETE", error);
		process.exit(1);
	});
async function resolvePaymentIntentInvoices(stripe: Stripe, pi: string) {
	const invoices = new Set<string>();
	for await (const payment of stripe.invoicePayments.list({
		payment: { type: "payment_intent", payment_intent: pi },
		status: "paid",
		limit: 100,
	})) {
		const invoice = identity(payment.invoice);
		if (
			!invoice ||
			payment.status !== "paid" ||
			payment.payment.type !== "payment_intent" ||
			identity(payment.payment.payment_intent) !== pi
		) {
			throw new Error("Payment intent/invoice ownership mismatch");
		}
		invoices.add(invoice);
	}
	return [...invoices];
}
