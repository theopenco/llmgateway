import { db } from "@llmgateway/db";

// Live (non-deleted) projects for an org, oldest first. The oldest project is
// the org's original "Default Project", used as the SSO provisioning fallback
// when no defaults are configured.
export async function getOrgProjectsOldestFirst(organizationId: string) {
	const projects = await db.query.project.findMany({
		where: { organizationId: { eq: organizationId } },
		columns: { id: true, name: true, status: true, createdAt: true },
	});
	return projects
		.filter((p) => p.status !== "deleted")
		.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

// Effective default project grants for a developer provisioned via SSO/SCIM:
// the org's configured set, or the oldest project when unconfigured, so members
// can see something out of the box. Returns [] only when the org has no
// projects at all.
export async function resolveDefaultProjectIds(
	organizationId: string,
): Promise<string[]> {
	const liveProjects = await getOrgProjectsOldestFirst(organizationId);
	const liveIds = new Set(liveProjects.map((p) => p.id));
	const configured = await db.query.ssoDefaultProject.findMany({
		where: { organizationId: { eq: organizationId } },
		columns: { projectId: true },
	});
	const selected = configured
		.map((row) => row.projectId)
		.filter((id) => liveIds.has(id));
	if (selected.length > 0) {
		return selected;
	}
	return liveProjects.length > 0 ? [liveProjects[0].id] : [];
}
