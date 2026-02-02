import { findUserFromOrganization } from "@/lib/cached-queries.js";

/**
 * Get the user associated with an organization (first user found)
 *
 * Uses cacheable select builder pattern with a join instead of
 * the relational query API (which does NOT use the cache).
 */
export async function getUserFromOrganization(organizationId: string) {
	const result = await findUserFromOrganization(organizationId);
	return result?.user || null;
}
