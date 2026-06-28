import { db } from "./db.js";

// Policy: org-scoped transactional and lifecycle emails must only be sent when
// the organization's owner has verified their account email. `billingEmail` is
// a free-form, user-editable field, so it cannot be trusted on its own — the
// owner's verified email is the signal that the account is real.

/**
 * Returns true only if the organization's owner has a verified account email.
 * Use to gate org-scoped emails sent to `organization.billingEmail`.
 */
export async function isOrgOwnerEmailVerified(
	organizationId: string,
): Promise<boolean> {
	const ownerMembership = await db.query.userOrganization.findFirst({
		where: {
			organizationId: { eq: organizationId },
			role: { eq: "owner" },
		},
		with: { user: true },
	});

	return ownerMembership?.user?.emailVerified ?? false;
}

/**
 * Resolves the recipient address for an org-scoped email, or `null` when the
 * organization's owner has not verified their email. Prefers the org's
 * `billingEmail`, falling back to the owner's account email.
 */
export async function resolveVerifiedOrgRecipient(
	organizationId: string,
): Promise<string | null> {
	const ownerMembership = await db.query.userOrganization.findFirst({
		where: {
			organizationId: { eq: organizationId },
			role: { eq: "owner" },
		},
		with: { user: true },
	});

	if (!ownerMembership?.user?.emailVerified) {
		return null;
	}

	const org = await db.query.organization.findFirst({
		where: { id: { eq: organizationId } },
	});

	return org?.billingEmail ?? ownerMembership.user.email ?? null;
}
