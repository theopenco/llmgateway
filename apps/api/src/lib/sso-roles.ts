import { cdb, db, eq, tables } from "@llmgateway/db";

export type OrgRole = "owner" | "admin" | "project_admin" | "developer";

export interface RoleChange {
	old: OrgRole;
	new: OrgRole;
}

const ROLE_RANK: Record<OrgRole, number> = {
	developer: 1,
	project_admin: 2,
	admin: 3,
	owner: 4,
};

// Recompute an org member's role from their SCIM group memberships and the
// org's group->role mappings. The highest-precedence mapped role wins. A
// mapping always promotes, but only a role a mapping granted (source "sso") is
// lowered or reset to `developer`: manual roles survive directory sync, and
// owners are never auto-demoted.
//
// Returns the {old,new} role change when it updated the membership, or null
// when nothing changed, so callers (e.g. SCIM) can audit the transition.
export async function recomputeUserRole(
	userId: string,
	organizationId: string,
): Promise<RoleChange | null> {
	const membership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organizationId },
		},
		columns: { id: true, role: true, roleAssignmentSource: true },
	});
	if (!membership) {
		return null;
	}

	const groupMemberships = await db.query.scimGroupMember.findMany({
		where: { userId: { eq: userId } },
		columns: { scimGroupId: true },
	});
	const groupIds = groupMemberships.map((m) => m.scimGroupId);

	let mappedRole: OrgRole | null = null;
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
			const mappings = await db.query.ssoRoleMapping.findMany({
				where: {
					organizationId: { eq: organizationId },
					groupName: { in: names },
				},
				columns: { role: true },
			});
			for (const mapping of mappings) {
				if (!mappedRole || ROLE_RANK[mapping.role] > ROLE_RANK[mappedRole]) {
					mappedRole = mapping.role;
				}
			}
		}
	}

	const targetRole = mappedRole ?? "developer";
	if (membership.role === targetRole) {
		return null;
	}
	const isDemotion = ROLE_RANK[targetRole] < ROLE_RANK[membership.role];
	if (
		isDemotion &&
		(membership.role === "owner" || membership.roleAssignmentSource !== "sso")
	) {
		return null;
	}

	await cdb
		.update(tables.userOrganization)
		.set({
			role: targetRole,
			roleAssignmentSource: mappedRole ? "sso" : "manual",
			...(targetRole === "developer"
				? {}
				: { teamId: null, teamAssignmentSource: "manual" as const }),
		})
		.where(eq(tables.userOrganization.id, membership.id));
	return { old: membership.role, new: targetRole };
}

// Recompute the role of every member of the SCIM group(s) with `groupName` in
// this org. Used when a role mapping is added or removed after the IdP has
// already pushed the group and its members, so existing members pick up (or
// lose) the mapped role without waiting for a later SCIM membership event.
export async function recomputeRoleForGroupName(
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
		await recomputeUserRole(userId, organizationId);
	}
}
