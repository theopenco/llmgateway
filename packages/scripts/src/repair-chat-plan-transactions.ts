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
 * This retypes those rows to `chat_plan_start` (restoring the credit amount and
 * description) and resets the chat org's `plan` back to `free`. The webhook fix
 * lives in apps/api/src/stripe.ts; this only cleans up rows written before it.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts repair-chat-plan-transactions            # dry run
 *   pnpm --filter @llmgateway/scripts repair-chat-plan-transactions --commit   # apply
 *   pnpm --filter @llmgateway/scripts repair-chat-plan-transactions --org=<id> # scope to one org
 *
 * Environment:
 *   DATABASE_URL - defaults to local postgres if unset
 */

import { and, db, eq, tables } from "@llmgateway/db";
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

async function main(): Promise<void> {
	const commit = hasFlag("commit");
	const scopeOrg = parseFlag("org");

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
			`  FIX  ${transaction.id} (org ${organization.id}): subscription_start -> chat_plan_start, tier ${tier}, credits ${creditAmount}${
				organization.plan === "pro" ? ", org plan pro -> free" : ""
			}`,
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

			if (organization.plan === "pro") {
				await db
					.update(tables.organization)
					.set({ plan: "free" })
					.where(eq(tables.organization.id, organization.id));
			}
		}

		repaired += 1;
	}

	console.log(
		`\n${commit ? "Repaired" : "Would repair"} ${repaired} row(s), skipped ${skipped}.`,
	);
	process.exit(0);
}

void main();
