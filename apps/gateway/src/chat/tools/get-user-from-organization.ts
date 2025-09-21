import { db } from "@/lib/db.js";

/**
 * Get the user associated with an organization (first user found)
 */
export async function getUserFromOrganization(organizationId: string) {
	const userOrg = await db.query.userOrganization.findFirst({
		where: (userOrganization, { eq }) =>
			eq(userOrganization.organizationId, organizationId),
		with: {
			user: true,
		},
	});

	return userOrg?.user || null;
}
