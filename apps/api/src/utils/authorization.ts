import { db } from "@llmgateway/db";

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
 * Get all project IDs that a user has access to through their organizations
 * @param userId - The user ID to check
 * @returns Promise<string[]> - Array of project IDs
 */
export async function getUserProjectIds(userId: string): Promise<string[]> {
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: userId,
			},
		},
		with: {
			organization: {
				with: {
					projects: true,
				},
			},
		},
	});

	return userOrgs.flatMap((org) =>
		org
			.organization!.projects.filter((project) => project.status !== "deleted")
			.map((project) => project.id),
	);
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
