/* eslint-disable no-console */
/**
 * One-time backfill: DevPass subscriptions used to be created with the forced
 * 3D Secure level in their Stripe payment settings, which Stripe applies to
 * every renewal. Off-session renewals then fail with `authentication_required`
 * on issuers that honour the request. Resets the level to `automatic` on every
 * DevPass and Lounge subscription that still carries one, and lists the ones
 * whose latest renewal is still unpaid so they can be retried by hand.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts clear-subscription-3ds                      # dry run
 *   pnpm --filter @llmgateway/scripts clear-subscription-3ds --commit             # apply
 *   pnpm --filter @llmgateway/scripts clear-subscription-3ds --subscription=sub_x # one subscription
 *
 * Environment:
 *   STRIPE_SECRET_KEY - required
 *   DATABASE_URL      - defaults to local postgres if unset
 */

import Stripe from "stripe";

import { db, isNotNull, or, tables } from "@llmgateway/db";

const STRIPE_API_VERSION = "2025-04-30.basil" as const;
const FORCED_LEVELS = new Set(["any", "challenge"]);
const ENDED_STATUSES = new Set<Stripe.Subscription.Status>([
	"canceled",
	"incomplete_expired",
]);

function getStripe(): Stripe {
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key) {
		throw new Error(
			"STRIPE_SECRET_KEY environment variable is required to run this script.",
		);
	}
	return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

function parseFlag(name: string): string | undefined {
	const flag = `--${name}=`;
	const arg = process.argv.find((a) => a.startsWith(flag));
	return arg ? arg.slice(flag.length) : undefined;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

// A malformed selector must not silently widen a --commit run to every
// subscription.
function parseSubscriptionFlag(): string | undefined {
	const provided = process.argv.some(
		(a) => a === "--subscription" || a.startsWith("--subscription="),
	);
	if (!provided) {
		return undefined;
	}
	const value = parseFlag("subscription");
	if (!value || !/^sub_[A-Za-z0-9]+$/.test(value)) {
		throw new Error(
			"--subscription must be a Stripe subscription id, e.g. --subscription=sub_123",
		);
	}
	return value;
}

async function main(): Promise<void> {
	const stripe = getStripe();
	const commit = hasFlag("commit");
	const only = parseSubscriptionFlag();

	console.log(
		`Mode: ${commit ? "COMMIT (writes enabled)" : "DRY RUN (no writes)"}`,
	);

	const orgs = await db
		.select({
			devPlanStripeSubscriptionId:
				tables.organization.devPlanStripeSubscriptionId,
			chatPlanStripeSubscriptionId:
				tables.organization.chatPlanStripeSubscriptionId,
		})
		.from(tables.organization)
		.where(
			or(
				isNotNull(tables.organization.devPlanStripeSubscriptionId),
				isNotNull(tables.organization.chatPlanStripeSubscriptionId),
			),
		);

	const subscriptionIds = orgs
		.flatMap((o) => [
			o.devPlanStripeSubscriptionId,
			o.chatPlanStripeSubscriptionId,
		])
		.filter((id): id is string => !!id)
		.filter((id) => !only || id === only);

	console.log(`Checking ${subscriptionIds.length} subscription(s)`);

	let forced = 0;
	let updated = 0;
	let unpaid = 0;

	for (const id of subscriptionIds) {
		let subscription: Stripe.Subscription;
		try {
			subscription = await stripe.subscriptions.retrieve(id, {
				expand: ["latest_invoice"],
			});
		} catch (error) {
			console.warn(
				`  ${id}: ${error instanceof Error ? error.message : String(error)}`,
			);
			continue;
		}

		const level =
			subscription.payment_settings?.payment_method_options?.card
				?.request_three_d_secure;
		if (!level || !FORCED_LEVELS.has(level)) {
			continue;
		}
		forced++;

		if (ENDED_STATUSES.has(subscription.status)) {
			console.log(`  ${id}: ${level} (${subscription.status}, skipped)`);
			continue;
		}

		console.log(`  ${id}: ${level} -> automatic (${subscription.status})`);
		if (commit) {
			await stripe.subscriptions.update(id, {
				payment_settings: {
					payment_method_options: {
						card: { request_three_d_secure: "automatic" },
					},
				},
			});
			updated++;
		}

		const invoice = subscription.latest_invoice;
		if (
			invoice &&
			typeof invoice !== "string" &&
			invoice.status === "open" &&
			invoice.attempted
		) {
			unpaid++;
			console.log(
				`    unpaid renewal ${invoice.id}: ${invoice.hosted_invoice_url ?? "no hosted invoice url"}`,
			);
		}
	}

	console.log(
		`\n${forced} subscription(s) carried a forced level, ${updated} updated, ${unpaid} with an unpaid renewal to retry.`,
	);
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
