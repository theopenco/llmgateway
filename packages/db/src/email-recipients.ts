import { normalizeEmail } from "@llmgateway/shared/email-unsubscribe";

import { db } from "./db.js";

import type { OrganizationEmailPreferences } from "./schema.js";
import type { EmailCategory } from "@llmgateway/shared/email-unsubscribe";

// Policy: org-scoped transactional and lifecycle emails must only be sent when
// the organization has at least one owner whose account email is verified.
// `billingEmail` is a free-form, user-editable field, so it cannot be trusted
// on its own — a verified owner is the signal that the account is real.
//
// An organization can have multiple `owner` memberships, so these helpers must
// not depend on which row the database happens to return first. Verification is
// an existence check across all owners (an org is legitimate if any owner has
// verified — a freshly invited, not-yet-verified co-owner must not block
// delivery), and the owner-email fallback is picked by a stable order rather
// than arbitrary database ordering.

interface OwnerMembership {
	id: string;
	createdAt: Date;
	user: { email: string; emailVerified: boolean } | null;
}

async function getOwnerMembershipsStable(
	organizationId: string,
): Promise<OwnerMembership[]> {
	const owners = await db.query.userOrganization.findMany({
		where: {
			organizationId: { eq: organizationId },
			role: { eq: "owner" },
		},
		with: { user: true },
	});

	// Deterministic order independent of DB row order: oldest membership first,
	// breaking createdAt ties by the stable membership id.
	return [...owners].sort(
		(a, b) =>
			a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
	);
}

/**
 * Returns true if the organization has at least one owner with a verified
 * account email. Use to gate org-scoped emails sent to
 * `organization.billingEmail`. Order-independent existence check.
 */
export async function isOrgOwnerEmailVerified(
	organizationId: string,
): Promise<boolean> {
	const owners = await getOwnerMembershipsStable(organizationId);
	return owners.some((m) => m.user?.emailVerified === true);
}

/**
 * Resolves the recipient address for an org-scoped email, or `null` when no
 * owner of the organization has a verified email. Prefers the org's
 * `billingEmail`, falling back to the earliest verified owner's account email.
 */
export async function resolveVerifiedOrgRecipient(
	organizationId: string,
): Promise<string | null> {
	const owners = await getOwnerMembershipsStable(organizationId);
	const verifiedOwner = owners.find((m) => m.user?.emailVerified === true);

	if (!verifiedOwner) {
		return null;
	}

	const org = await db.query.organization.findFirst({
		where: { id: { eq: organizationId } },
	});

	return org?.billingEmail ?? verifiedOwner.user?.email ?? null;
}

/**
 * True when the address has unsubscribed from this category. Address-keyed
 * because org recipients are often `billingEmail`, which need not be a user.
 */
export async function isEmailSuppressed(
	email: string,
	category: EmailCategory,
): Promise<boolean> {
	const row = await db.query.emailUnsubscribe.findFirst({
		where: { email: { eq: normalizeEmail(email) }, category: { eq: category } },
	});
	return Boolean(row);
}

/** Org-level toggle from the dashboard. Missing preferences means enabled. */
export function isOrgCategoryEnabled(
	preferences: OrganizationEmailPreferences | null | undefined,
	category: EmailCategory,
): boolean {
	if (!preferences) {
		return true;
	}
	return category === "marketing"
		? preferences.marketing !== false
		: preferences.creditAlerts !== false;
}

/**
 * Combined gate for an optional email: the org must not have turned the
 * category off, and the recipient must not have unsubscribed.
 */
export async function canSendEmailCategory(input: {
	email: string;
	category: EmailCategory;
	organizationPreferences?: OrganizationEmailPreferences | null;
}): Promise<boolean> {
	if (!isOrgCategoryEnabled(input.organizationPreferences, input.category)) {
		return false;
	}
	return !(await isEmailSuppressed(input.email, input.category));
}
