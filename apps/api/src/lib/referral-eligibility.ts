import { Decimal } from "decimal.js";

import { emailDomain, isFreeMailDomain } from "@/lib/crm.js";

import { and, db, eq, gte, inArray, sql, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

/**
 * Net paid credit purchases (USD, refunds subtracted) an organization needs
 * before its referral link earns anything. The dashboard shows the same rule,
 * but only this check counts: the referral cookie is just an org id, so anyone
 * can hand-craft one.
 */
export const REFERRAL_MIN_NET_TOP_UPS_USD = 100;

/** Referrals one organization may collect per day before new ones are refused. */
export const REFERRAL_MAX_PER_DAY = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back member sessions are compared against the new user's IP. */
const SELF_REFERRAL_IP_LOOKBACK_MS = 90 * DAY_MS;

/** Ledger rows that move real money into an organization's credit balance. */
const PAID_CREDIT_TYPES = [
	"credit_topup",
	"credit_manual_payment",
	"credit_refund",
] as const;

export type ReferralRejectionReason =
	| "referrer_not_found"
	| "referrer_inactive"
	| "referrer_risk_flagged"
	| "referrer_not_eligible"
	| "referrer_daily_limit"
	| "same_user"
	| "same_email"
	| "same_email_domain"
	| "same_ip";

/**
 * Credits bought with real money, net of refunds. `credit_refund` rows carry a
 * negative `creditAmount`, so a refunded purchase cancels itself out.
 */
export async function getNetPaidTopUps(organizationId: string) {
	const [row] = await db
		.select({
			total: sql<string>`coalesce(sum(${tables.transaction.creditAmount}), 0)`,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, organizationId),
				eq(tables.transaction.status, "completed"),
				inArray(tables.transaction.type, [...PAID_CREDIT_TYPES]),
			),
		);
	return new Decimal(row?.total ?? "0");
}

/**
 * Whether an organization may refer others at all: it exists, is active, is
 * not flagged as high risk, and has paid at least the minimum net top-ups.
 */
export async function checkReferrerEligibility(
	referrerOrganizationId: string,
): Promise<
	{ eligible: true } | { eligible: false; reason: ReferralRejectionReason }
> {
	const referrer = await db.query.organization.findFirst({
		where: { id: { eq: referrerOrganizationId } },
		columns: { id: true, status: true, riskFlagged: true },
	});
	if (!referrer) {
		return { eligible: false, reason: "referrer_not_found" };
	}
	if (referrer.status !== "active") {
		return { eligible: false, reason: "referrer_inactive" };
	}
	if (referrer.riskFlagged) {
		return { eligible: false, reason: "referrer_risk_flagged" };
	}
	const netPaid = await getNetPaidTopUps(referrerOrganizationId);
	if (netPaid.lessThan(REFERRAL_MIN_NET_TOP_UPS_USD)) {
		return { eligible: false, reason: "referrer_not_eligible" };
	}
	return { eligible: true };
}

/**
 * Collapses mailbox aliases so `a.b+x@gmail.com` and `ab@gmail.com` compare
 * equal. Dots are only insignificant for Gmail; the `+tag` suffix is dropped
 * for every domain.
 */
export function normalizeEmailForComparison(email: string): string {
	const lower = email.trim().toLowerCase();
	const at = lower.lastIndexOf("@");
	if (at < 0) {
		return lower;
	}
	let local = lower.slice(0, at).split("+")[0];
	let domain = lower.slice(at + 1);
	if (domain === "googlemail.com") {
		domain = "gmail.com";
	}
	if (domain === "gmail.com") {
		local = local.replaceAll(".", "");
	}
	return `${local}@${domain}`;
}

/**
 * Decides whether a new signup may be recorded as referred by an organization.
 *
 * Beyond the referrer's own eligibility, this refuses self-referrals: the new
 * user already being a member, the same mailbox under an alias, a shared
 * non-freemail domain, or signing up from an IP one of the referrer's members
 * used recently. It also caps how many referrals one org collects per day so a
 * script cannot farm a link.
 */
export async function checkReferralAllowed(params: {
	referrerOrganizationId: string;
	referredUser: { id: string; email: string };
	ipAddress?: string | null;
}): Promise<
	{ allowed: true } | { allowed: false; reason: ReferralRejectionReason }
> {
	const { referrerOrganizationId, referredUser, ipAddress } = params;

	const referrer = await checkReferrerEligibility(referrerOrganizationId);
	if (!referrer.eligible) {
		return { allowed: false, reason: referrer.reason };
	}

	const members = await db.query.userOrganization.findMany({
		where: { organizationId: { eq: referrerOrganizationId } },
		with: { user: { columns: { id: true, email: true } } },
	});
	const memberUsers = members
		.map((member) => member.user)
		.filter((user): user is { id: string; email: string } => Boolean(user));

	if (memberUsers.some((user) => user.id === referredUser.id)) {
		return { allowed: false, reason: "same_user" };
	}

	const referredNormalized = normalizeEmailForComparison(referredUser.email);
	if (
		memberUsers.some(
			(user) => normalizeEmailForComparison(user.email) === referredNormalized,
		)
	) {
		return { allowed: false, reason: "same_email" };
	}

	const referredDomain = emailDomain(referredUser.email);
	if (
		referredDomain &&
		!isFreeMailDomain(referredDomain) &&
		memberUsers.some((user) => emailDomain(user.email) === referredDomain)
	) {
		return { allowed: false, reason: "same_email_domain" };
	}

	if (ipAddress && memberUsers.length > 0) {
		const since = new Date(Date.now() - SELF_REFERRAL_IP_LOOKBACK_MS);
		const sharedSession = await db.query.session.findFirst({
			where: {
				userId: { in: memberUsers.map((user) => user.id) },
				ipAddress: { eq: ipAddress },
				createdAt: { gte: since },
			},
			columns: { id: true },
		});
		if (sharedSession) {
			return { allowed: false, reason: "same_ip" };
		}
	}

	const dayAgo = new Date(Date.now() - DAY_MS);
	const [recent] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(tables.referral)
		.where(
			and(
				eq(tables.referral.referrerOrganizationId, referrerOrganizationId),
				gte(tables.referral.createdAt, dayAgo),
			),
		);
	if ((recent?.count ?? 0) >= REFERRAL_MAX_PER_DAY) {
		return { allowed: false, reason: "referrer_daily_limit" };
	}

	return { allowed: true };
}

/**
 * Takes back the 1% referral earnings that a refunded payment of a referred
 * organization generated. Clamped to what the referrer has earned in total so
 * the balance it never received is not debited.
 */
export async function clawBackReferralEarnings(
	referredOrganizationId: string,
	refundedAmountUsd: number,
): Promise<void> {
	if (!(refundedAmountUsd > 0)) {
		return;
	}
	const referral = await db.query.referral.findFirst({
		where: { referredOrganizationId: { eq: referredOrganizationId } },
	});
	if (!referral) {
		return;
	}
	const clawback = new Decimal(refundedAmountUsd).times(0.01).toString();
	const [updated] = await db
		.update(tables.organization)
		.set({
			credits: sql`${tables.organization.credits} - LEAST(${clawback}::numeric, ${tables.organization.referralEarnings})`,
			referralEarnings: sql`GREATEST(${tables.organization.referralEarnings} - ${clawback}::numeric, 0)`,
		})
		.where(eq(tables.organization.id, referral.referrerOrganizationId))
		.returning({ id: tables.organization.id });
	if (updated) {
		logger.info("Clawed back referral earnings after refund", {
			referrerOrgId: referral.referrerOrganizationId,
			referredOrgId: referredOrganizationId,
			clawback,
		});
	}
}
