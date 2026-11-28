import { notFound } from "next/navigation";

import { fetchServerData } from "@/lib/server-api";

import type { Organization, Project } from "@/lib/types";
import type { cookies } from "next/headers";

type CookieStore = Pick<Awaited<ReturnType<typeof cookies>>, "get">;

interface ProjectsResponse {
	projects: Project[];
}

export interface PlaygroundContext {
	organizations: Organization[];
	selectedOrganization: Organization | null;
	projects: Project[];
	selectedProject: Project | null;
	projectsLoadFailed: boolean;
}

function fetchProjects(organizationId: string) {
	return fetchServerData<ProjectsResponse>("GET", "/orgs/{id}/projects", {
		params: { path: { id: organizationId } },
	});
}

/**
 * Resolves the organization and project a studio page bills against. The
 * dedicated Chat org is ensured first and backs the default selection; an
 * explicit `orgId` wins when it names a selectable org, and an explicit
 * `projectId` that is not in the selected org's projects is a 404. With
 * `projectIdRequiresOrgId`, `projectId` only applies when `orgId` resolved to
 * the selected org; otherwise the last-used or first project is selected.
 */
export async function resolvePlaygroundContext({
	orgId,
	projectId,
	cookieStore,
	projectIdRequiresOrgId = false,
}: {
	orgId?: string;
	projectId?: string;
	projectIdRequiresOrgId?: boolean;
	cookieStore: CookieStore;
}): Promise<PlaygroundContext> {
	const chatOrgPromise = fetchServerData<{
		organizationId: string;
		projectId: string;
	}>("GET", "/playground/chat-org");

	const [organizationsData, orgIdProjectsData, chatOrgData, chatOrgProjects] =
		await Promise.all([
			chatOrgPromise.then(() =>
				fetchServerData<{ organizations: Organization[] }>("GET", "/orgs", {
					params: { query: { includeChat: "true" } },
				}),
			),
			orgId ? fetchProjects(orgId) : null,
			chatOrgPromise,
			orgId
				? null
				: chatOrgPromise.then((chatOrg) =>
						chatOrg ? fetchProjects(chatOrg.organizationId) : null,
					),
		]);

	const allOrganizations = organizationsData?.organizations ?? [];
	// The Chat org backs the default billing context and must not appear in the
	// dashboard org switcher.
	const chatOrg = allOrganizations.find((o) => o.kind === "chat") ?? null;
	const organizations = allOrganizations.filter((o) => o.kind === "default");
	const selectedOrganization =
		(orgId ? organizations.find((o) => o.id === orgId) : null) ??
		chatOrg ??
		organizations[0] ??
		null;

	if (!selectedOrganization) {
		return {
			organizations,
			selectedOrganization: null,
			projects: [],
			selectedProject: null,
			projectsLoadFailed: false,
		};
	}

	// Projects fetched for an orgId that did not resolve to the selected
	// organization are discarded so the list always matches the billing context.
	const projectsData =
		(orgId === selectedOrganization.id
			? orgIdProjectsData
			: selectedOrganization.id === chatOrgData?.organizationId
				? chatOrgProjects
				: null) ?? (await fetchProjects(selectedOrganization.id));

	const projects = projectsData?.projects ?? [];
	const projectsLoadFailed = projectsData === null;

	let selectedProject: Project | null = null;
	if (
		projectId &&
		(!projectIdRequiresOrgId || orgId === selectedOrganization.id)
	) {
		selectedProject = projects.find((p) => p.id === projectId) ?? null;
		if (!selectedProject && !projectsLoadFailed) {
			notFound();
		}
	} else {
		const lastUsed = cookieStore.get(
			`llmgateway-last-used-project-${selectedOrganization.id}`,
		)?.value;
		if (lastUsed) {
			selectedProject = projects.find((p) => p.id === lastUsed) ?? null;
		}
	}
	selectedProject ??= projects[0] ?? null;

	return {
		organizations,
		selectedOrganization,
		projects,
		selectedProject,
		projectsLoadFailed,
	};
}
