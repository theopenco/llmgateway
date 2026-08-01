import {
	getOrgProjectsOldestFirst,
	resolveDefaultProjectIds,
} from "@/lib/sso-default-projects.js";

import { and, db, eq, inArray, tables } from "@llmgateway/db";

export interface ProjectGrantChange {
	added: string[];
	removed: string[];
}

// Recompute an org member's SSO-derived project grants from their SCIM group
// memberships and the org's group->project mappings. Projects mapped to any of
// the user's groups replace the org's default project set (the defaults only
// act as a fallback for members whose groups map to no projects). Only rows
// with `source: "sso"` are synced; grants made manually in the team UI are
// never touched, and an existing manual row for a mapped project wins (so it
// also survives a later group removal).
//
// Owners/admins have implicit all-project access, so these rows only take
// effect for `developer` members (and are harmless otherwise).
//
// Returns the {added,removed} project ids when grants changed, or null when
// nothing changed, so callers (e.g. SCIM) can audit the transition.
export async function recomputeUserProjects(
	userId: string,
	organizationId: string,
): Promise<ProjectGrantChange | null> {
	const membership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organizationId },
		},
		columns: { id: true },
	});
	if (!membership) {
		return null;
	}

	const groupMemberships = await db.query.scimGroupMember.findMany({
		where: { userId: { eq: userId } },
		columns: { scimGroupId: true },
	});
	const groupIds = groupMemberships.map((m) => m.scimGroupId);

	let mapped: string[] = [];
	if (groupIds.length) {
		const groups = await db.query.scimGroup.findMany({
			where: {
				id: { in: groupIds },
				organizationId: { eq: organizationId },
			},
			columns: { displayName: true },
		});
		const names = groups.map((g) => g.displayName);
		if (names.length) {
			const mappings = await db.query.ssoProjectMapping.findMany({
				where: {
					organizationId: { eq: organizationId },
					groupName: { in: names },
				},
				columns: { projectId: true },
			});
			// Projects are soft-deleted (status "deleted"), so the FK cascade never
			// clears mappings for them — filter to live projects here.
			const liveIds = new Set(
				(await getOrgProjectsOldestFirst(organizationId)).map((p) => p.id),
			);
			mapped = [
				...new Set(
					mappings.map((m) => m.projectId).filter((id) => liveIds.has(id)),
				),
			];
		}
	}

	const desired = mapped.length
		? mapped
		: await resolveDefaultProjectIds(organizationId);
	const desiredSet = new Set(desired);

	const current = await db.query.userProject.findMany({
		where: { userOrganizationId: { eq: membership.id } },
		columns: { projectId: true, source: true },
	});
	const currentIds = new Set(current.map((row) => row.projectId));

	const toRemove = current
		.filter((row) => row.source === "sso" && !desiredSet.has(row.projectId))
		.map((row) => row.projectId);
	const toAdd = desired.filter((id) => !currentIds.has(id));

	if (toRemove.length) {
		await db
			.delete(tables.userProject)
			.where(
				and(
					eq(tables.userProject.userOrganizationId, membership.id),
					eq(tables.userProject.source, "sso"),
					inArray(tables.userProject.projectId, toRemove),
				),
			);
	}
	if (toAdd.length) {
		await db
			.insert(tables.userProject)
			.values(
				toAdd.map((projectId) => ({
					userOrganizationId: membership.id,
					projectId,
					source: "sso" as const,
				})),
			)
			.onConflictDoNothing();
	}

	if (!toAdd.length && !toRemove.length) {
		return null;
	}
	return { added: toAdd, removed: toRemove };
}

// Recompute the project grants of every member of the SCIM group(s) with
// `groupName` in this org. Used when a project mapping is added or removed
// after the IdP has already pushed the group and its members, so existing
// members pick up (or lose) the mapped projects without waiting for a later
// SCIM membership event.
export async function recomputeProjectsForGroupName(
	organizationId: string,
	groupName: string,
) {
	const groups = await db.query.scimGroup.findMany({
		where: {
			organizationId: { eq: organizationId },
			displayName: { eq: groupName },
		},
		columns: { id: true },
	});
	if (!groups.length) {
		return;
	}

	const members = await db.query.scimGroupMember.findMany({
		where: { scimGroupId: { in: groups.map((g) => g.id) } },
		columns: { userId: true },
	});
	const userIds = [...new Set(members.map((m) => m.userId))];
	for (const userId of userIds) {
		await recomputeUserProjects(userId, organizationId);
	}
}
