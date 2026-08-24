import { and, db, eq, ne, tables } from "@llmgateway/db";

/**
 * Ids of every non-deleted project in an organization.
 *
 * Every usage rollup table is keyed on `projectId`, so this is the org scope
 * filter for org-wide usage queries (dashboard analytics and the master API
 * usage report alike).
 */
export async function getOrgProjectIds(
	organizationId: string,
): Promise<string[]> {
	const projects = await db
		.select({ id: tables.project.id })
		.from(tables.project)
		.where(
			and(
				eq(tables.project.organizationId, organizationId),
				ne(tables.project.status, "deleted"),
			),
		);
	return projects.map((p) => p.id);
}
