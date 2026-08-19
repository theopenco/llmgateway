import { HTTPException } from "hono/http-exception";

import { db } from "@llmgateway/db";

/**
 * Ensures the authenticated user is an owner/admin of an enterprise
 * organization. Member-level usage analytics expose every member's spend, so
 * they are restricted to organization administrators on the enterprise plan.
 */
export async function requireEnterpriseAdmin(
	userId: string,
	organizationId: string,
): Promise<void> {
	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organizationId },
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	if (userOrganization.role === "developer") {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can view member usage",
		});
	}

	const organization = await db.query.organization.findFirst({
		where: { id: { eq: organizationId } },
	});

	if (!organization || organization.status === "deleted") {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	if (organization.plan !== "enterprise") {
		throw new HTTPException(403, {
			message: "Member analytics require an enterprise plan",
		});
	}
}
