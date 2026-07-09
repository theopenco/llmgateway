import { db, type tables } from "@llmgateway/db";

import { findDefaultOrganization } from "./default-org.js";

type Organization = typeof tables.organization.$inferSelect;

export interface PlanBillingDetails {
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
}): PlanBillingDetails {
	return {
		billingEmail: org.billingEmail,
		billingCompany: org.billingCompany,
		billingAddress: org.billingAddress,
		billingTaxId: org.billingTaxId,
		billingNotes: org.billingNotes,
	};
}

// Mirror the owner's default ("main") organization billing details — company,
// address, tax id, notes and email. Falls back to the given per-user (devpass
// or chat) org when the owner has no default org.
async function resolveDefaultOrgBillingDetails(
	personalOrg: Organization,
): Promise<PlanBillingDetails> {
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

// Resolve the billing details to use on a DevPass invoice for `personalOrg`.
// When the override flag is off (default), the owner's default-org billing
// details are mirrored exactly (company, address, tax id, notes, and email);
// when on, the DevPass org's own billing* fields are used.
export async function resolveDevPassBillingDetails(
	personalOrg: Organization,
): Promise<PlanBillingDetails> {
	if (personalOrg.devPlanBillingOverride) {
		return pickBillingDetails(personalOrg);
	}

	return await resolveDefaultOrgBillingDetails(personalOrg);
}

// Chat plan invoices always bill against the owner's default ("main") org
// billing settings — chat orgs have no per-plan billing override.
export async function resolveChatPlanBillingDetails(
	personalOrg: Organization,
): Promise<PlanBillingDetails> {
	return await resolveDefaultOrgBillingDetails(personalOrg);
}
