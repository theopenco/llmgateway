import { cdb, db, eq, tables } from "@llmgateway/db";

export interface TeamAssignmentChange {
	old: string | null;
	new: string | null;
}

// Recompute a developer's team from SCIM group mappings. Manual assignments
// win, and the first mapped group name wins when several groups target
// different teams.
export async function recomputeUserTeam(
	userId: string,
	organizationId: string,
): Promise<TeamAssignmentChange | null> {
	const membership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organizationId },
		},
		columns: {
			id: true,
			role: true,
			teamId: true,
			teamAssignmentSource: true,
		},
	});
	if (!membership) {
		return null;
	}

	if (membership.role !== "developer") {
		if (
			membership.teamId === null ||
			membership.teamAssignmentSource === "manual"
		) {
			return null;
		}
		await cdb
			.update(tables.userOrganization)
			.set({ teamId: null, teamAssignmentSource: "manual" })
			.where(eq(tables.userOrganization.id, membership.id));
		return { old: membership.teamId, new: null };
	}

	// An admin's explicit team choice survives directory changes. Clearing a
	// synced assignment does not: the next SCIM event restores the mapping.
	if (
		membership.teamId !== null &&
		membership.teamAssignmentSource === "manual"
	) {
		return null;
	}

	const groupMemberships = await db.query.scimGroupMember.findMany({
		where: { userId: { eq: userId } },
		columns: { scimGroupId: true },
	});
	const groupIds = groupMemberships.map((entry) => entry.scimGroupId);
	let teamId: string | null = null;

	if (groupIds.length > 0) {
		const groups = await db.query.scimGroup.findMany({
			where: {
				id: { in: groupIds },
				organizationId: { eq: organizationId },
			},
			columns: { displayName: true },
		});
		const groupNames = groups.map((group) => group.displayName);
		if (groupNames.length > 0) {
			const mappings = await db.query.ssoTeamMapping.findMany({
				where: {
					organizationId: { eq: organizationId },
					groupName: { in: groupNames },
				},
				columns: { groupName: true, teamId: true },
			});
			mappings.sort((left, right) =>
				left.groupName < right.groupName
					? -1
					: left.groupName > right.groupName
						? 1
						: 0,
			);
			teamId = mappings[0]?.teamId ?? null;
		}
	}

	if (membership.teamId === teamId) {
		return null;
	}

	await cdb
		.update(tables.userOrganization)
		.set({
			teamId,
			teamAssignmentSource: teamId === null ? "manual" : "sso",
		})
		.where(eq(tables.userOrganization.id, membership.id));
	return { old: membership.teamId, new: teamId };
}

// Recompute current members immediately when an admin creates, changes, or
// removes a mapping for a group the IdP already pushed.
export async function recomputeTeamForGroupName(
	organizationId: string,
	groupName: string,
): Promise<void> {
	const groups = await db.query.scimGroup.findMany({
		where: {
			organizationId: { eq: organizationId },
			displayName: { eq: groupName },
		},
		columns: { id: true },
	});
	if (groups.length === 0) {
		return;
	}

	const members = await db.query.scimGroupMember.findMany({
		where: { scimGroupId: { in: groups.map((group) => group.id) } },
		columns: { userId: true },
	});
	for (const userId of new Set(members.map((member) => member.userId))) {
		await recomputeUserTeam(userId, organizationId);
	}
}
