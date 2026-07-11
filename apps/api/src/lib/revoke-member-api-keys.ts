import { and, cdb, db, eq, inArray, ne, tables } from "@llmgateway/db";

/**
 * Revoke the API keys a member created within an organization.
 *
 * API keys are scoped to a project (which belongs to an org) and record their
 * creator in `createdBy`, but the gateway authenticates a request purely on
 * `apiKey.status`/project status — it never re-checks that the creator is still
 * a member. So when a member is removed (via the dashboard) or deprovisioned
 * (via SCIM), their `userOrganization` row is deleted but their keys keep
 * working. Call this at every membership-removal chokepoint to soft-delete those
 * keys so access is actually revoked.
 *
 * Scoped to `keyType: "user"` (personal developer keys) on purpose: platform and
 * end-user keys are shared org infrastructure that must not break because the
 * individual who happened to create them left. Setting `status: "deleted"`
 * auto-invalidates the gateway's `apiKey` cache, so revocation takes effect on
 * the next request.
 *
 * @returns the number of keys revoked.
 */
export async function revokeMemberApiKeys(
	userId: string,
	organizationId: string,
): Promise<number> {
	const projects = await db.query.project.findMany({
		where: { organizationId: { eq: organizationId } },
		columns: { id: true },
	});
	const projectIds = projects.map((p) => p.id);
	if (projectIds.length === 0) {
		return 0;
	}

	const revoked = await cdb
		.update(tables.apiKey)
		.set({ status: "deleted" })
		.where(
			and(
				eq(tables.apiKey.createdBy, userId),
				inArray(tables.apiKey.projectId, projectIds),
				eq(tables.apiKey.keyType, "user"),
				ne(tables.apiKey.status, "deleted"),
			),
		)
		.returning({ id: tables.apiKey.id });

	return revoked.length;
}
