import { getUserProjectIds } from "@llmgateway/actions";
import { db } from "@llmgateway/db";

export {
	getUserProjectIds,
	getApiKeyScope,
	isKeyScoped,
	type ApiKeyScope,
} from "@llmgateway/actions";

/**
 * Get all organization IDs that a user belongs to
 * @param userId - The user ID to check
 * @returns Promise<string[]> - Array of organization IDs
 */
export async function getUserOrganizationIds(
	userId: string,
): Promise<string[]> {
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: userId,
			},
		},
		with: {
			organization: true,
		},
	});
	return userOrgs.map((uo) => uo.organization!.id);
}

/**
 * Check whether a user can access a specific project (RBAC-aware).
 */
export async function userHasProjectAccess(
	userId: string,
	projectId: string,
): Promise<boolean> {
	const projectIds = await getUserProjectIds(userId);
	return projectIds.includes(projectId);
}

/**
 * Get the organization IDs where the user is an owner or admin. Org-level
 * resources (provider keys, custom models, billing, discounts, etc.) are
 * administered here, so project-scoped "developer" members are excluded.
 */
export async function getAdminOrganizationIds(
	userId: string,
): Promise<string[]> {
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: userId,
			},
		},
		with: {
			organization: true,
		},
	});
	return userOrgs
		.filter(
			(uo) =>
				uo.organization?.status !== "deleted" &&
				(uo.role === "owner" || uo.role === "admin"),
		)
		.map((uo) => uo.organization!.id);
}

/**
 * Get all active (non-deleted) organization IDs that a user belongs to
 * @param userId - The user ID to check
 * @returns Promise<string[]> - Array of active organization IDs
 */
export async function getActiveUserOrganizationIds(
	userId: string,
): Promise<string[]> {
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: userId,
			},
		},
		with: {
			organization: true,
		},
	});
	return userOrgs
		.filter((uo) => uo.organization?.status !== "deleted")
		.map((uo) => uo.organization!.id);
}

/**
 * Check if a user has access to a specific organization
 * @param userId - The user ID to check
 * @param organizationId - The organization ID to check access for
 * @returns Promise<boolean> - true if user has access
 */
export async function userHasOrganizationAccess(
	userId: string,
	organizationId: string,
): Promise<boolean> {
	const userOrg = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: userId,
			},
			organizationId: {
				eq: organizationId,
			},
		},
	});
	return !!userOrg;
}
