import { DatabaseCache } from "@llmgateway/cache";

/**
 * Get the user associated with an organization (first user found)
 */
export async function getUserFromOrganization(organizationId: string) {
	return await DatabaseCache.getUserFromOrganization(organizationId);
}
