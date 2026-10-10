/**
 * Backfills `provider_listing_payment` from Stripe for listing fees paid before
 * the webhook started recording them. Scans every completed checkout session,
 * so duplicate charges and fees for since-deleted requests are included.
 * Idempotent; pass `--dry-run` to report without writing.
 *
 *   pnpm --filter api backfill:provider-listing-payments [--dry-run]
 *   node dist/scripts/backfill-provider-listing-payments.js [--dry-run]
 */
import { Decimal } from "decimal.js";

import { getStripe } from "@/routes/payments.js";
import {
	getProviderListingPaymentSource,
	recordProviderListingPayment,
} from "@/utils/provider-listing-payment.js";

import {
	and,
	db,
	eq,
	isNotNull,
	isNull,
	notInArray,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

const dryRun = process.argv.includes("--dry-run");

async function backfill() {
	let scanned = 0;
	let matched = 0;
	let inserted = 0;
	let total = new Decimal(0);

	for await (const session of getStripe().checkout.sessions.list({
		limit: 100,
		status: "complete",
		expand: ["data.payment_intent.latest_charge"],
	})) {
		scanned++;
		if (
			!getProviderListingPaymentSource(session) ||
			session.payment_status !== "paid"
		) {
			continue;
		}
		matched++;
		total = total.plus(new Decimal(session.amount_total ?? 0).div(100));

		const paymentIntent =
			typeof session.payment_intent === "object"
				? session.payment_intent
				: null;
		const charge =
			paymentIntent && typeof paymentIntent.latest_charge === "object"
				? paymentIntent.latest_charge
				: null;
		// Seconds since the epoch; the charge settles later than the session
		// opens for delayed payment methods.
		const paidAt = new Date((charge?.created ?? session.created) * 1000);

		if (dryRun) {
			logger.info("Would record listing payment", {
				sessionId: session.id,
				type: session.metadata?.type,
				amountTotal: session.amount_total,
				paidAt: paidAt.toISOString(),
			});
			continue;
		}

		if (
			await recordProviderListingPayment(session, {
				paidAt,
				refundedAmount: new Decimal(charge?.amount_refunded ?? 0).div(100),
			})
		) {
			inserted++;
		}
	}

	logger.info("Provider listing payment backfill finished", {
		dryRun,
		scanned,
		matched,
		inserted,
		total: total.toString(),
	});

	if (dryRun) {
		return;
	}

	// Companies paid through Stripe (not waived by invite code) that the scan
	// could not account for, e.g. charged on another Stripe account.
	const recorded = db
		.select({ id: tables.providerListingPayment.providerCompanyId })
		.from(tables.providerListingPayment)
		// A NULL in a NOT IN list makes every comparison NULL.
		.where(
			and(
				eq(tables.providerListingPayment.source, "airside"),
				isNotNull(tables.providerListingPayment.providerCompanyId),
			),
		);
	const unmatched = await db
		.select({ id: tables.providerCompany.id })
		.from(tables.providerCompany)
		.where(
			and(
				eq(tables.providerCompany.paymentStatus, "paid"),
				isNull(tables.providerCompany.listingInviteCode),
				notInArray(tables.providerCompany.id, recorded),
			),
		);
	if (unmatched.length > 0) {
		logger.warn("Paid provider companies without a recorded payment", {
			providerCompanyIds: unmatched.map((row) => row.id),
		});
	}
}

void backfill()
	.then(() => process.exit(0))
	.catch((err) => {
		logger.error(
			"Provider listing payment backfill failed",
			err instanceof Error ? err : new Error(String(err)),
		);
		process.exit(1);
	});
