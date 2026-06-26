import { db, type tables } from "@llmgateway/db";

import { findDefaultOrganization } from "./default-org.js";

type Organization = typeof tables.organization.$inferSelect;

export interface DevPassBillingDetails {
	billingEmail: string;
	billingCompany: string | null;
	billingAddress: string | null;
	billingTaxId: string | null;
	billingNotes: string | null;
}

function pickBillingDetails(org: {
	billingEmail: string;
	billingCompany: string | null;
	billingAddress: string | null;
	billingTaxId: string | null;
	billingNotes: string | null;
}): DevPassBillingDetails {
	return {
		billingEmail: org.billingEmail,
		billingCompany: org.billingCompany,
		billingAddress: org.billingAddress,
		billingTaxId: org.billingTaxId,
		billingNotes: org.billingNotes,
	};
}

// Resolve the billing details to use on a DevPass invoice for `personalOrg`.
// When the override flag is off (default), the owner's default-org billing
// details are mirrored exactly (company, address, tax id, notes, and email);
// when on, the DevPass org's own billing* fields are used.
export async function resolveDevPassBillingDetails(
	personalOrg: Organization,
): Promise<DevPassBillingDetails> {
	if (personalOrg.devPlanBillingOverride) {
		return pickBillingDetails(personalOrg);
	}

	const owner = await db.query.userOrganization.findFirst({
		where: {
			organizationId: { eq: personalOrg.id },
			role: { eq: "owner" },
		},
		with: { user: true },
	});

	const defaultOrg = owner?.user
		? await findDefaultOrganization(owner.user.id, owner.user.email)
		: null;

	return pickBillingDetails(defaultOrg ?? personalOrg);
}
