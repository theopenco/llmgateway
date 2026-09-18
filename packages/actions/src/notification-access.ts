import { db } from "@llmgateway/db";
import { isProjectScopedRole } from "@llmgateway/shared/organization-roles";

/**
 * Get all project IDs a user can access, honoring project-level RBAC.
 *
 * - owner/admin members have implicit access to every non-deleted project in
 *   their org.
 * - Project admins and developers are limited to the projects explicitly granted to them
 *   via the user_project table.
 *
 * @param userId - The user ID to check
 * @returns Promise<string[]> - Array of accessible project IDs
 */
export async function getUserProjectIds(userId: string): Promise<string[]> {
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: userId,
			},
		},
		with: {
			organization: {
				with: {
					projects: true,
				},
			},
			userProjects: true,
			team: { with: { projects: true } },
		},
	});

	const projectIds = new Set<string>();
	for (const membership of userOrgs) {
		if (membership.organization?.status === "deleted") {
			continue;
		}
		const projects = (membership.organization?.projects ?? []).filter(
			(project) => project.status !== "deleted",
		);
		if (isProjectScopedRole(membership.role)) {
			const granted = new Set(
				membership.userProjects.map((grant) => grant.projectId),
			);
			const teamGranted =
				membership.role === "developer" && membership.team
					? new Set(membership.team.projects.map((grant) => grant.projectId))
					: null;
			for (const project of projects) {
				if (
					granted.has(project.id) &&
					(!teamGranted || teamGranted.has(project.id))
				) {
					projectIds.add(project.id);
				}
			}
		} else {
			for (const project of projects) {
				projectIds.add(project.id);
			}
		}
	}

	return Array.from(projectIds);
}

/**
 * The api keys a user is allowed to see usage for, within a set of projects.
 *
 * owner/admin members see every key in their projects. "developer" members are
 * limited to the keys they created — project access alone does not entitle them
 * to a teammate's traffic, cost, or request payloads.
 *
 * `restrictedProjectIds` is the subset of `projectIds` where the caller is a
 * developer; `ownApiKeyIds` are their keys inside those projects. A user can be
 * an owner in one org and a developer in another, so both lists are needed to
 * build a correct filter:
 *
 *   projectId IN privilegedProjectIds
 *     OR (projectId IN restrictedProjectIds AND apiKeyId IN ownApiKeyIds)
 */
export interface ApiKeyScope {
	privilegedProjectIds: string[];
	restrictedProjectIds: string[];
	ownApiKeyIds: string[];
}

export async function getApiKeyScope(
	userId: string,
	projectIds: string[],
): Promise<ApiKeyScope> {
	if (!projectIds.length) {
		return {
			privilegedProjectIds: [],
			restrictedProjectIds: [],
			ownApiKeyIds: [],
		};
	}

	const userOrgs = await db.query.userOrganization.findMany({
		where: { userId: { eq: userId } },
		with: { organization: { with: { projects: true } } },
	});

	const inScope = new Set(projectIds);
	const privilegedProjectIds: string[] = [];
	const restrictedProjectIds: string[] = [];

	for (const membership of userOrgs) {
		for (const project of membership.organization?.projects ?? []) {
			if (!inScope.has(project.id)) {
				continue;
			}
			if (membership.role === "developer") {
				restrictedProjectIds.push(project.id);
			} else {
				privilegedProjectIds.push(project.id);
			}
		}
	}

	if (!restrictedProjectIds.length) {
		return { privilegedProjectIds, restrictedProjectIds, ownApiKeyIds: [] };
	}

	const ownKeys = await db.query.apiKey.findMany({
		where: {
			projectId: { in: restrictedProjectIds },
			createdBy: { eq: userId },
		},
		columns: { id: true },
	});

	return {
		privilegedProjectIds,
		restrictedProjectIds,
		ownApiKeyIds: ownKeys.map((key) => key.id),
	};
}

/**
 * True when the caller is a developer in at least one of the projects in scope,
 * i.e. the query must be narrowed to their own keys.
 */
export function isKeyScoped(scope: ApiKeyScope): boolean {
	return scope.restrictedProjectIds.length > 0;
}
