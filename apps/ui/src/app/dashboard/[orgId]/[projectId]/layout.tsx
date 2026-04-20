import { LastUsedProjectTracker } from "@/components/dashboard/last-used-project-tracker";
import { UnauthorizedView } from "@/components/dashboard/unauthorized-view";
import { fetchServerData } from "@/lib/server-api";

import type { Project } from "@/lib/types";
import type { ReactNode } from "react";

interface ProjectLayoutProps {
	children: ReactNode;
	params: Promise<{ orgId: string; projectId: string }>;
}

export default async function ProjectLayout({
	children,
	params,
}: ProjectLayoutProps) {
	const { orgId, projectId } = await params;

	// Fetch projects for the specific organization to validate project exists
	let initialProjectsData = null;
	if (orgId) {
		try {
			initialProjectsData = await fetchServerData(
				"GET",
				"/orgs/{id}/projects",
				{
					params: {
						path: {
							id: orgId,
						},
					},
				},
			);
		} catch (error) {
			console.warn("Failed to fetch projects for organization:", orgId, error);
		}
	}

	// Validate that the project exists and is not deleted
	if (
		projectId &&
		initialProjectsData &&
		typeof initialProjectsData === "object" &&
		"projects" in initialProjectsData &&
		Array.isArray((initialProjectsData as { projects: unknown }).projects)
	) {
		const projects = (initialProjectsData as { projects: Project[] }).projects;
		const currentProject = projects.find((p: Project) => p.id === projectId);

		// If project is not found in the active projects list, the user either doesn't have access or it doesn't exist
		if (!currentProject) {
			return <UnauthorizedView resource="project" />;
		}
	} else if (projectId) {
		// Projects list could not be loaded (e.g. user doesn't have access to the org)
		return <UnauthorizedView resource="project" />;
	}

	return (
		<>
			<LastUsedProjectTracker orgId={orgId} projectId={projectId} />
			{children}
		</>
	);
}
