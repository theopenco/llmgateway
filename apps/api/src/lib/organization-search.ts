import { escapeLikePattern } from "@/lib/like-pattern.js";

import { or, sql, tables } from "@llmgateway/db";

/**
 * Admin organization search: name, billing email or member email (substring),
 * organization or safety id (substring), or an exact project / API key id.
 * Returns `undefined` for an empty search so callers decide explicitly what
 * "no filter" means.
 */
export function buildOrganizationSearchFilter(search: string | undefined) {
	const trimmed = search?.trim();
	if (!trimmed) {
		return undefined;
	}

	const textPattern = `%${escapeLikePattern(trimmed.toLowerCase())}%`;
	const idPattern = `%${escapeLikePattern(trimmed)}%`;

	return or(
		sql`LOWER(${tables.organization.name}) LIKE ${textPattern} ESCAPE '\\'`,
		sql`LOWER(${tables.organization.billingEmail}) LIKE ${textPattern} ESCAPE '\\'`,
		sql`${tables.organization.id} LIKE ${idPattern} ESCAPE '\\'`,
		// Provider abuse reports quote the safety identifier we send upstream.
		sql`${tables.organization.safetyIdentifier} LIKE ${idPattern} ESCAPE '\\'`,
		// Project and API key IDs match exactly, resolving to their organization.
		sql`EXISTS (SELECT 1 FROM ${tables.project} p WHERE p.organization_id = ${tables.organization.id} AND p.id = ${trimmed})`,
		sql`EXISTS (SELECT 1 FROM ${tables.apiKey} ak JOIN ${tables.project} p ON ak.project_id = p.id WHERE p.organization_id = ${tables.organization.id} AND ak.id = ${trimmed})`,
		sql`EXISTS (SELECT 1 FROM ${tables.userOrganization} uo JOIN ${tables.user} u ON uo.user_id = u.id WHERE uo.organization_id = ${tables.organization.id} AND LOWER(u.email) LIKE ${textPattern} ESCAPE '\\')`,
	);
}
