import { DashboardLayoutClient } from "@/components/dashboard/dashboard-layout-client";
import { UserProvider } from "@/components/providers/user-provider";
import { SidebarProvider } from "@/lib/components/sidebar";
import { getLastUsedProjectId } from "@/lib/last-used-project-server";
import { fetchServerData } from "@/lib/server-api";

import type { User, Project } from "@/lib/types";
import type { ReactNode } from "react";

interface OrgLayoutProps {
	children: ReactNode;
	params: Promise<{ orgId: string }>;
}

export default async function OrgLayout({ children, params }: OrgLayoutProps) {
	const { orgId } = await params;

	const initialUserData = await fetchServerData<
		{ user: User } | undefined | null
	>("GET", "/user/me");

	const initialOrganizationsData = await fetchServerData("GET", "/orgs");

	let initialProjectsData = null;
	let lastUsedProjectId: string | undefined;

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

			// Get last used project for navigation fallback
			if (
				initialProjectsData &&
				typeof initialProjectsData === "object" &&
				"projects" in initialProjectsData
			) {
				const projects = (initialProjectsData as { projects: Project[] })
					.projects;
				const lastUsedId = await getLastUsedProjectId(orgId);

				// Only use last used project if it exists in the current projects list
				if (lastUsedId && projects.some((p) => p.id === lastUsedId)) {
					lastUsedProjectId = lastUsedId;
				} else if (projects.length > 0) {
					// Fallback to first project if no valid last-used project
					lastUsedProjectId = projects[0].id;
				}
			}
		} catch (error) {
			console.warn("Failed to fetch projects for organization:", orgId, error);
		}
	}

	return (
		<UserProvider initialUserData={initialUserData}>
			<SidebarProvider>
				<DashboardLayoutClient
					initialOrganizationsData={initialOrganizationsData}
					initialProjectsData={initialProjectsData}
					selectedOrgId={orgId}
					selectedProjectId={lastUsedProjectId}
				>
					{children}
				</DashboardLayoutClient>
			</SidebarProvider>
		</UserProvider>
	);
}
