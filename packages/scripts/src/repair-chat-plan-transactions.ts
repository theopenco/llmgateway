/* eslint-disable no-console */
/**
 * One-time repair: Lounge memberships whose opening payment was recorded as a
 * generic `subscription_start` row.
 *
 * Stripe does not order webhooks. When the first invoice of a new membership
 * was delivered before its `checkout.session.completed`, the invoice handler
 * did not yet see the subscription on the org and fell through to the Pro
 * branch: it wrote a `subscription_start` row (and flipped the chat org to
 * `plan: "pro"`), after which the checkout handler skipped its `chat_plan_start`
 * insert because a row for that invoice already existed. The membership itself
 * works, but the payment row is not a self-refund candidate, so the member never
 * sees a Refund button in the billing history.
 *
 * Two passes. The first retypes those rows to `chat_plan_start`, restoring the
 * credit amount and description. The second clears Pro-subscription state from
 * every chat org — `plan: "pro"` and a `stripeSubscriptionId` holding the Lounge
 * subscription, both of which `customer.subscription.created` used to stamp
 * before it learned to skip non-default org kinds. That pass is not limited to
 * orgs from the first: an org could lose the Pro-state race without losing the
 * transaction one.
 *
 * The webhook fix lives in apps/api/src/stripe.ts; this only cleans up state
 * written before it.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts repair-chat-plan-transactions            # dry run
 *   pnpm --filter @llmgateway/scripts repair-chat-plan-transactions --commit   # apply
 *   pnpm --filter @llmgateway/scripts repair-chat-plan-transactions --org=<id> # scope to one org
 *
 * Environment:
 *   DATABASE_URL - defaults to local postgres if unset
 */

import { and, db, eq, isNotNull, or, tables } from "@llmgateway/db";
import {
	CHAT_PLAN_PRICES,
	getChatPlanCreditsLimit,
	type ChatPlanTier,
} from "@llmgateway/shared";

function parseFlag(name: string): string | undefined {
	const flag = `--${name}=`;
	const arg = process.argv.find((a) => a.startsWith(flag));
	return arg ? arg.slice(flag.length) : undefined;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

function tierFromAmount(amount: string | null): ChatPlanTier | null {
	if (amount === null) {
		return null;
	}
	const value = Number(amount);
	const tiers = Object.keys(CHAT_PLAN_PRICES) as ChatPlanTier[];
	return tiers.find((tier) => CHAT_PLAN_PRICES[tier] === value) ?? null;
}

/**
 * Host and database name of the connection, credentials stripped. An unset
 * DATABASE_URL silently falls back to local postgres, so print the target: a
 * run that reports "0 rows" should be recognisable as "wrong database" rather
 * than "nothing to repair".
 */
function describeTarget(): string {
	const url = process.env.DATABASE_URL;
	if (!url) {
		return "local default (DATABASE_URL is not set)";
	}
	try {
		const parsed = new URL(url);
		return `${parsed.host}${parsed.pathname}`;
	} catch {
		return "unparseable DATABASE_URL";
	}
}

async function main(): Promise<void> {
	const commit = hasFlag("commit");
	const scopeOrg = parseFlag("org");

	console.log(`Database: ${describeTarget()}`);
	console.log(
		`Mode: ${commit ? "COMMIT (writes enabled)" : "DRY RUN (no writes)"}`,
	);
	if (scopeOrg) {
		console.log(`Scoped to organization: ${scopeOrg}`);
	}

	const rows = await db
		.select({
			transaction: tables.transaction,
			organization: tables.organization,
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.type, "subscription_start"),
				eq(tables.organization.kind, "chat"),
				...(scopeOrg ? [eq(tables.organization.id, scopeOrg)] : []),
			),
		);

	console.log(
		`\nFound ${rows.length} subscription_start row(s) on chat organizations`,
	);

	let repaired = 0;
	let skipped = 0;

	for (const { transaction, organization } of rows) {
		// The charged amount identifies the tier outright; a discounted charge
		// (promo code) falls back to the tier the org is on today.
		const tier =
			tierFromAmount(transaction.amount) ??
			(organization.chatPlan !== "none"
				? (organization.chatPlan as ChatPlanTier)
				: null);

		if (!tier) {
			console.log(
				`  SKIP ${transaction.id} (org ${organization.id}): cannot resolve tier from amount ${transaction.amount} and org has no chat plan`,
			);
			skipped += 1;
			continue;
		}

		const creditAmount =
			transaction.creditAmount ?? getChatPlanCreditsLimit(tier).toString();
		const description = `Lounge ${tier.toUpperCase()} membership started`;

		console.log(
			`  FIX  ${transaction.id} (org ${organization.id}): subscription_start -> chat_plan_start, tier ${tier}, credits ${creditAmount}`,
		);

		if (commit) {
			await db
				.update(tables.transaction)
				.set({
					type: "chat_plan_start",
					creditAmount,
					description,
				})
				.where(eq(tables.transaction.id, transaction.id));
		}

		repaired += 1;
	}

	console.log(
		`\n${commit ? "Repaired" : "Would repair"} ${repaired} row(s), skipped ${skipped}.`,
	);

	// Second pass, deliberately not limited to orgs with a mistyped transaction:
	// `customer.subscription.created` also used to flip chat orgs to Pro (and
	// stamp the Lounge subscription into `stripeSubscriptionId`, which is
	// reserved for team-org Pro subscriptions), and it did so whether or not the
	// invoice webhook won its own race. A chat org can never hold a Pro
	// subscription — all three writers refuse non-default kinds today — so both
	// fields are residue by definition.
	const corruptOrgs = await db
		.select()
		.from(tables.organization)
		.where(
			and(
				eq(tables.organization.kind, "chat"),
				or(
					eq(tables.organization.plan, "pro"),
					isNotNull(tables.organization.stripeSubscriptionId),
				),
				...(scopeOrg ? [eq(tables.organization.id, scopeOrg)] : []),
			),
		);

	console.log(
		`\nFound ${corruptOrgs.length} chat organization(s) carrying Pro-subscription state`,
	);

	for (const organization of corruptOrgs) {
		const changes = [
			...(organization.plan === "pro" ? ["plan pro -> free"] : []),
			...(organization.stripeSubscriptionId
				? [
						`stripe_subscription_id ${organization.stripeSubscriptionId} -> null`,
					]
				: []),
		];
		console.log(`  FIX  org ${organization.id}: ${changes.join(", ")}`);

		if (commit) {
			await db
				.update(tables.organization)
				.set({
					...(organization.plan === "pro" ? { plan: "free" as const } : {}),
					...(organization.stripeSubscriptionId
						? { stripeSubscriptionId: null }
						: {}),
				})
				.where(eq(tables.organization.id, organization.id));
		}
	}

	console.log(
		`\n${commit ? "Cleaned" : "Would clean"} ${corruptOrgs.length} organization(s).`,
	);
	process.exit(0);
}

void main();
