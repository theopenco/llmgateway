import { db } from "@llmgateway/db";

const DEFAULT_REFERRAL_BONUS_PERCENT = 50;

/**
 * Safely parses a stored referral bonus percent (decimal column → string),
 * falling back to the default when the value is missing or malformed.
 */
export function parseReferralBonusPercent(
	value: string | number | null | undefined,
): number {
	if (value === null || value === undefined || value === "") {
		return DEFAULT_REFERRAL_BONUS_PERCENT;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : DEFAULT_REFERRAL_BONUS_PERCENT;
}

/**
 * Computes the referral signup bonus for an organization's first top-up.
 *
 * The bonus is configured on the referrer organization and only applies when
 * the organization was referred (signed up via a referral link). Callers are
 * responsible for gating this to the referred org's first purchase.
 */
export async function computeReferralBonus(
	organizationId: string,
	creditAmount: number,
): Promise<number> {
	const referralRecord = await db.query.referral.findFirst({
		where: {
			referredOrganizationId: { eq: organizationId },
		},
	});

	if (!referralRecord) {
		return 0;
	}

	const referrerOrg = await db.query.organization.findFirst({
		where: {
			id: { eq: referralRecord.referrerOrganizationId },
		},
	});

	if (!referrerOrg || !referrerOrg.referralBonusEnabled) {
		return 0;
	}

	const percent = parseReferralBonusPercent(referrerOrg.referralBonusPercent);
	if (percent <= 0) {
		return 0;
	}

	return creditAmount * (percent / 100);
}
