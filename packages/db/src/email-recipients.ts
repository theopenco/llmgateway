import { db } from "./db.js";

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
