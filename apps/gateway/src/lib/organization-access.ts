import { HTTPException } from "hono/http-exception";

import type { InferSelectModel, tables } from "@llmgateway/db";

type Organization = InferSelectModel<typeof tables.organization>;

export const ORGANIZATION_DISABLED_MESSAGE =
	"Organization has been disabled and is no longer accessible";

export const ORGANIZATION_HIGH_RISK_MESSAGE =
	"This account is under review and cannot be used. Please use the Contact Us link or email contact@llmgateway.io so we can unlock your account.";

/**
 * Reason an organization may not serve requests, or null when it may. Split
 * from the throwing helper below because the realtime and Responses paths
 * report errors as values instead of exceptions.
 */
export function getOrganizationBlockReason(
	organization: Pick<Organization, "status" | "riskFlagged">,
): { status: 410 | 403; message: string } | null {
	if (organization.status === "deleted") {
		return { status: 410, message: ORGANIZATION_DISABLED_MESSAGE };
	}
	// Flagged by the abuse-IP check at sign-up or email verification and not yet
	// approved by an admin. No inference of any kind until then.
	if (organization.riskFlagged) {
		return { status: 403, message: ORGANIZATION_HIGH_RISK_MESSAGE };
	}
	return null;
}

/** Throws when the organization is disabled or flagged as high risk. */
export function assertOrganizationUsable(
	organization: Pick<Organization, "status" | "riskFlagged">,
): void {
	const blocked = getOrganizationBlockReason(organization);
	if (blocked) {
		throw new HTTPException(blocked.status, { message: blocked.message });
	}
}
