import { HTTPException } from "hono/http-exception";

import { db } from "@llmgateway/db";

/**
 * Ensures the authenticated user may see every member's spend within one
 * project.
 *
 * Unlike `requireEnterpriseAdmin`, this admits a project-scoped member holding a
 * `lead` grant on that project (`user_project.role`). A team lead needs to see
 * what their own team costs without being promoted to org admin, which would
 * also hand them billing, provider keys and every other project.
 *
 * The enterprise-plan gate is unchanged: per-member analytics stay an enterprise
 * feature regardless of who is asking.
 */
export async function requireProjectUsageVisibility(
	userId: string,
	organizationId: string,
	projectId: string,
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

	if (userOrganization.role !== "developer") {
		return;
	}

	const lead = await db.query.userProject.findFirst({
		where: {
			userOrganizationId: { eq: userOrganization.id },
			projectId: { eq: projectId },
			role: { eq: "lead" },
		},
	});

	if (!lead) {
		throw new HTTPException(403, {
			message:
				"Only organization owners, admins and project leads can view member usage",
		});
	}
}
