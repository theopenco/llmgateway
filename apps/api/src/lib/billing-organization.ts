import { HTTPException } from "hono/http-exception";

import { db } from "@llmgateway/db";
import { isOrganizationAdmin } from "@llmgateway/shared/organization-roles";

export async function getBillingOrganization(
	userId: string,
	organizationId?: string,
) {
	const membership = await db.query.userOrganization.findFirst({
		where: organizationId ? { userId, organizationId } : { userId },
		with: { organization: true, user: true },
	});
	if (
		!membership?.organization ||
		membership.organization.status === "deleted"
	) {
		throw new HTTPException(404, { message: "Organization not found" });
	}
	if (!isOrganizationAdmin(membership.role)) {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can access billing",
		});
	}
	return { ...membership, organization: membership.organization };
}
