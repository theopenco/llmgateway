import { HTTPException } from "hono/http-exception";

import { and, db, eq, isNotNull, or, tables } from "@llmgateway/db";

/**
 * Kill switch for credit purchases by new organizations, used while under a
 * card-testing / fraud attack. Blocks manual top-up endpoints only — the
 * worker's auto top-up loop and Stripe webhook renewal paths never call this,
 * so existing auto top-ups and renewals are unaffected.
 */
export const CREDIT_PURCHASE_BLOCK_SETTING_ID =
	"block_new_org_credit_purchases";

export const CREDIT_PURCHASE_BLOCKED_MESSAGE =
	"Credit purchases for new accounts are temporarily disabled while we mitigate an ongoing attack. Existing subscriptions and automatic top-ups are unaffected. Please try again later or contact contact@llmgateway.io.";

/** Env override: forces the block on regardless of the admin toggle. */
export function isCreditPurchaseBlockForcedByEnv(): boolean {
	return process.env.DISABLE_NEW_ORG_CREDIT_PURCHASES === "true";
}

export async function isCreditPurchaseBlockEnabled(): Promise<boolean> {
	if (isCreditPurchaseBlockForcedByEnv()) {
		return true;
	}
	const setting = await db.query.systemSetting.findFirst({
		where: { id: CREDIT_PURCHASE_BLOCK_SETTING_ID },
	});
	return setting?.enabled ?? false;
}

/**
 * "New" means the org has never completed a real Stripe payment (no completed
 * transaction carrying a payment-intent or invoice id), so every org that has
 * ever paid keeps its purchasing ability while fresh attack accounts do not.
 */
async function hasCompletedStripePayment(
	organizationId: string,
): Promise<boolean> {
	const [paid] = await db
		.select({ id: tables.transaction.id })
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, organizationId),
				eq(tables.transaction.status, "completed"),
				or(
					isNotNull(tables.transaction.stripePaymentIntentId),
					isNotNull(tables.transaction.stripeInvoiceId),
				),
			),
		)
		.limit(1);
	return Boolean(paid);
}

/** Throws 403 when the block is active and the org has no payment history. */
export async function assertCreditPurchaseAllowed(
	organizationId: string,
): Promise<void> {
	if (!(await isCreditPurchaseBlockEnabled())) {
		return;
	}
	if (await hasCompletedStripePayment(organizationId)) {
		return;
	}
	throw new HTTPException(403, {
		message: CREDIT_PURCHASE_BLOCKED_MESSAGE,
	});
}
