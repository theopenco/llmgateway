import { cachedDb as db } from "@/lib/cached-db.js";

/**
 * Get the user associated with an organization (first user found)
 */
export async function getUserFromOrganization(organizationId: string) {
	const userOrg = await db.query.userOrganization.findFirst({
		where: {
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			user: true,
		},
	});

	return userOrg?.user || null;
}
