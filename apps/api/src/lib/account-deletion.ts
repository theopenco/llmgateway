import { Decimal } from "decimal.js";
import Stripe from "stripe";

import { getStripe } from "@/routes/payments.js";

import { db, eq, inArray, or, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

/**
 * Credit balances at or above this are worth warning about before the account
 * is deleted and the balance is forfeited. Dust below it isn't worth a scary
 * dialog.
 */
export const CREDIT_FORFEIT_WARNING_THRESHOLD = new Decimal("1");

/**
 * Placeholders written over the personal identifiers on an organization that is
 * closed as part of an account deletion.
 *
 * The organization row itself survives the deletion — it is marked
 * `status: "deleted"` rather than removed, because the `transaction` rows that
 * make up the accounting record reference it and have to be kept for 10 years
 * (HGB §257 / AO §147, GDPR Art. 17(3)(b)). Only the fields that the accounting
 * record does not need are overwritten: the display name (user-settable, often
 * the person's real name), the billing contact email (the account email), and
 * the logo (frequently a profile photo). `billingCompany` / `billingAddress` /
 * `billingTaxId` are deliberately kept — they are the statutory "bill to"
 * identity on the invoices we already issued.
 */
export const DELETED_ORGANIZATION_NAME = "Deleted Organization";
export const DELETED_ORGANIZATION_BILLING_EMAIL = "deleted@deleted.invalid";

/**
 * Every Stripe subscription an organization can hold: the dashboard
 * Pro/Enterprise plan, the DevPass (dev plan) subscription, and the Chat plan
 * subscription. They live in three separate columns, so any teardown path that
 * only looks at one of them silently leaves the others billing.
 */
export interface OrganizationSubscriptionRefs {
	stripeSubscriptionId: string | null;
	devPlanStripeSubscriptionId: string | null;
	chatPlanStripeSubscriptionId: string | null;
}

export function getOrganizationSubscriptionIds(
	org: OrganizationSubscriptionRefs,
): string[] {
	return [
		org.stripeSubscriptionId,
		org.devPlanStripeSubscriptionId,
		org.chatPlanStripeSubscriptionId,
	].filter((id): id is string => Boolean(id));
}

/**
 * Whether a Stripe error means the subscription is already in the terminal
 * state a cancel was aiming for — gone, or cancelled earlier. Callers treat
 * this as success rather than failing an otherwise-complete teardown.
 */
export function isTerminalSubscriptionError(
	error: unknown,
): error is Stripe.errors.StripeInvalidRequestError {
	return (
		error instanceof Stripe.errors.StripeInvalidRequestError &&
		(error.code === "resource_missing" ||
			error.statusCode === 404 ||
			error.message.includes("already been canceled") ||
			error.message.includes("already canceled"))
	);
}

/**
 * Cancels every Stripe subscription an organization holds, immediately and
 * without a final proration invoice.
 *
 * Treats already-cancelled or missing subscriptions as success — their terminal
 * state is exactly what we want — and re-throws every other Stripe error so the
 * caller can abort instead of tearing down local state while Stripe keeps
 * charging.
 */
export async function cancelOrganizationSubscriptions(
	org: OrganizationSubscriptionRefs,
): Promise<string[]> {
	const cancelled: string[] = [];

	for (const subscriptionId of getOrganizationSubscriptionIds(org)) {
		try {
			await getStripe().subscriptions.cancel(subscriptionId, {
				invoice_now: false,
				prorate: false,
			});
			cancelled.push(subscriptionId);
		} catch (error) {
			if (isTerminalSubscriptionError(error)) {
				logger.info(
					`Stripe subscription ${subscriptionId} already terminal, skipping cancel: ${error.message}`,
				);
				cancelled.push(subscriptionId);
				continue;
			}
			throw error;
		}
	}

	return cancelled;
}

/**
 * Returns true when a Stripe error means the object we wanted gone is already
 * gone. Deleting something that does not exist is the outcome we were after, so
 * these are success, not failure.
 */
function isStripeResourceMissing(error: unknown): boolean {
	return (
		error instanceof Stripe.errors.StripeInvalidRequestError &&
		(error.code === "resource_missing" || error.statusCode === 404)
	);
}

/**
 * Deletes the Stripe customer backing an organization, as part of erasing the
 * account that owned it.
 *
 * Stripe holds a copy of the name, email and billing address on the customer
 * object, so an erasure that only clears our own database leaves that copy
 * behind at a sub-processor. Deleting the customer is Stripe's documented
 * erasure path: the customer object is marked deleted and its saved payment
 * methods are detached, while the charges and invoices stay attached to it so
 * Stripe can keep meeting its own accounting obligations.
 *
 * Returns true when the customer was deleted (or was already gone). Every other
 * Stripe error is re-thrown so the caller aborts the deletion with the account
 * still intact and retryable, rather than erasing locally while Stripe keeps
 * the personal data.
 */
export async function deleteOrganizationStripeCustomer(
	stripeCustomerId: string | null,
): Promise<boolean> {
	if (!stripeCustomerId) {
		return false;
	}

	try {
		await getStripe().customers.del(stripeCustomerId);
		return true;
	} catch (error) {
		if (isStripeResourceMissing(error)) {
			logger.info(
				`Stripe customer ${stripeCustomerId} already deleted, skipping: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return true;
		}
		throw error;
	}
}

/**
 * Strips the deleted user's email out of the billing tables that outlive the
 * account.
 *
 * `payment_failure` cascades from `organization`, not from `user`, and the
 * organization row is kept for the 10-year accounting period — so without this
 * the raw account email survives erasure indefinitely. The email is a
 * notification address, not part of the accounting record (the amount, decline
 * code and Stripe payment-intent id are), so it is nulled rather than retained.
 *
 * Scoped by email rather than by organization on purpose: a user can trigger a
 * payment in a shared organization that keeps existing because other members
 * remain, and their address has to come out of that row too.
 */
export async function anonymizeBillingRecordsForEmail(
	email: string,
	closedOrganizationIds: string[] = [],
): Promise<number> {
	// `payment_failure` records the email as it was at the time of the failure
	// and has no user foreign key, so matching on the current address alone
	// misses rows written before an email change. Sweeping the organizations
	// being closed alongside it catches those: they are personal or
	// last-member-only orgs, so every address on them belongs to this user.
	// A shared organization that survives is still matched by email — the only
	// residue is a stale address on a *shared* org from before an email change,
	// which needs a stable user reference on the table to fix properly
	// (tracked in legal/DATA_RETENTION_POLICY.md).
	const anonymized = await db
		.update(tables.paymentFailure)
		.set({ userEmail: null })
		.where(
			closedOrganizationIds.length > 0
				? or(
						eq(tables.paymentFailure.userEmail, email),
						inArray(
							tables.paymentFailure.organizationId,
							closedOrganizationIds,
						),
					)
				: eq(tables.paymentFailure.userEmail, email),
		)
		.returning({ id: tables.paymentFailure.id });

	return anonymized.length;
}

/**
 * Clears every subscription-backed entitlement after all Stripe subscriptions
 * have been cancelled. Historical transactions remain intact for accounting.
 */
export function getCancelledOrganizationPlanState(now = new Date()) {
	return {
		plan: "free" as const,
		stripeSubscriptionId: null,
		subscriptionCancelled: true,
		planExpiresAt: now,
		isTrialActive: false,
		autoTopUpEnabled: false,
		devPlan: "none" as const,
		devPlanStripeSubscriptionId: null,
		devPlanCancelled: true,
		devPlanExpiresAt: now,
		devPlanPendingTier: null,
		chatPlan: "none" as const,
		chatPlanStripeSubscriptionId: null,
		chatPlanCancelled: true,
		chatPlanExpiresAt: now,
	};
}

export interface SoleMemberOrganization {
	id: string;
	name: string;
	kind: "default" | "chat" | "devpass";
	plan: "free" | "pro" | "enterprise";
	devPlan: "none" | "lite" | "pro" | "max";
	chatPlan: "none" | "starter" | "plus" | "pro";
	credits: string;
	/** Balance is large enough that losing it deserves an explicit warning. */
	hasForfeitableCredits: boolean;
	subscriptions: OrganizationSubscriptionRefs;
	subscriptionIds: string[];
	/** Stripe customer holding the org's name, email and billing address. */
	stripeCustomerId: string | null;
}

/**
 * Returns the organizations the user is the *only* remaining member of.
 *
 * Deleting a user only cascades away their `user_organization` row — the
 * organization itself survives with no members and no way to reach it from any
 * UI, so anything still attached to it (most importantly a live Stripe
 * subscription) keeps charging the card forever. These are the orgs that have
 * to be torn down along with the account. DevPass and Chat orgs are personal by
 * construction, so they always land here; a shared team org only does when the
 * user is its last member.
 */
export async function findSoleMemberOrganizations(
	userId: string,
): Promise<SoleMemberOrganization[]> {
	const memberships = await db.query.userOrganization.findMany({
		where: { userId: { eq: userId } },
		columns: { organizationId: true },
	});

	const orgIds = memberships.map((m) => m.organizationId);
	if (orgIds.length === 0) {
		return [];
	}

	const allMembers = await db.query.userOrganization.findMany({
		where: { organizationId: { in: orgIds } },
		columns: { organizationId: true, userId: true },
	});

	const orgIdsWithOtherMembers = new Set(
		allMembers
			.filter((member) => member.userId !== userId)
			.map((member) => member.organizationId),
	);

	const soleOrgIds = orgIds.filter((id) => !orgIdsWithOtherMembers.has(id));
	if (soleOrgIds.length === 0) {
		return [];
	}

	// Teardown cancels subscriptions org by org and stops at the first Stripe
	// failure, so the order has to be reproducible: without it, which orgs were
	// already cancelled before an outage depends on the row order Postgres
	// happens to return.
	const organizations = await db.query.organization.findMany({
		where: { id: { in: soleOrgIds } },
		orderBy: { createdAt: "asc", id: "asc" },
	});

	return organizations
		.filter((org) => org.status !== "deleted")
		.map((org) => {
			const subscriptions: OrganizationSubscriptionRefs = {
				stripeSubscriptionId: org.stripeSubscriptionId,
				devPlanStripeSubscriptionId: org.devPlanStripeSubscriptionId,
				chatPlanStripeSubscriptionId: org.chatPlanStripeSubscriptionId,
			};

			return {
				id: org.id,
				name: org.name,
				kind: org.kind,
				plan: org.plan,
				devPlan: org.devPlan,
				chatPlan: org.chatPlan,
				credits: org.credits,
				hasForfeitableCredits: new Decimal(org.credits).gte(
					CREDIT_FORFEIT_WARNING_THRESHOLD,
				),
				subscriptions,
				subscriptionIds: getOrganizationSubscriptionIds(subscriptions),
				stripeCustomerId: org.stripeCustomerId,
			};
		});
}

/**
 * Tears down the organizations a user is the last member of, as part of
 * deleting their account: cancels every Stripe subscription those orgs hold,
 * deletes their Stripe customer, then marks them deleted with all plan state
 * cleared and the personal identifiers overwritten.
 *
 * Stripe is called before any local write so a Stripe failure aborts the whole
 * account deletion — leaving the account intact and retryable is strictly
 * better than deleting it while a subscription keeps charging the card, or
 * while personal data stays behind at Stripe.
 *
 * Subscriptions are cancelled before the customer is deleted. Deleting a
 * customer cancels its subscriptions too, but it does so without our
 * `prorate: false` / `invoice_now: false` terms, so an explicit cancel first
 * keeps the "no final proration invoice" guarantee.
 *
 * The subscription id columns are nulled once cancelled, which also makes the
 * trailing `customer.subscription.deleted` webhook a no-op (every handler gates
 * on the stored id) — the terminal state is already applied here.
 */
export async function tearDownSoleMemberOrganizations(
	userId: string,
): Promise<SoleMemberOrganization[]> {
	const organizations = await findSoleMemberOrganizations(userId);
	if (organizations.length === 0) {
		return [];
	}

	const now = new Date();

	// Phase 1: every Stripe call, for every organization, before a single local
	// write. Interleaving them per-organization would mean a Stripe failure on
	// the second org left the first already anonymized and marked deleted while
	// the account survived — a partial state no retry can clean up, since the
	// anonymized org no longer carries the identifiers the retry would need.
	for (const org of organizations) {
		const cancelled = await cancelOrganizationSubscriptions(org.subscriptions);

		if (cancelled.length > 0) {
			logger.info(
				`Cancelled Stripe subscriptions for organization ${org.id} on account deletion of user ${userId}: ${cancelled.join(", ")}`,
			);
		}

		const customerDeleted = await deleteOrganizationStripeCustomer(
			org.stripeCustomerId,
		);

		if (customerDeleted) {
			logger.info(
				`Deleted Stripe customer ${org.stripeCustomerId} for organization ${org.id} on account deletion of user ${userId}`,
			);
		}
	}

	// Phase 2: local writes only. Nothing here calls out, so once the first
	// update lands the rest follow.
	for (const org of organizations) {
		await db
			.update(tables.organization)
			.set({
				status: "deleted",
				name: DELETED_ORGANIZATION_NAME,
				billingEmail: DELETED_ORGANIZATION_BILLING_EMAIL,
				logo: null,
				stripeCustomerId: null,
				...getCancelledOrganizationPlanState(now),
			})
			.where(eq(tables.organization.id, org.id));
	}

	return organizations;
}
