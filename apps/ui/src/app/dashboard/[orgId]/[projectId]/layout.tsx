import { notFound } from "next/navigation";

import { DashboardLayoutClient } from "@/components/dashboard/dashboard-layout-client";
import { LastUsedProjectTracker } from "@/components/dashboard/last-used-project-tracker";
import { UserProvider } from "@/components/providers/user-provider";
import { SidebarProvider } from "@/lib/components/sidebar";
import { fetchServerData } from "@/lib/server-api";

import type { User, Project } from "@/lib/types";
import type { ReactNode } from "react";

// Force dynamic rendering since this layout uses cookies for authentication
export const dynamic = "force-dynamic";

interface ProjectLayoutProps {
	children: ReactNode;
	params: Promise<{ orgId: string; projectId: string }>;
}

export default async function ProjectLayout({
	children,
	params,
}: ProjectLayoutProps) {
	const { orgId, projectId } = await params;

	// Fetch user data server-side
	const initialUserData = await fetchServerData<
		{ user: User } | undefined | null
	>("GET", "/user/me");

	// Fetch organizations server-side
	const initialOrganizationsData = await fetchServerData("GET", "/orgs");

	// Fetch projects for the specific organization
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
		"projects" in initialProjectsData
	) {
		const projects = (initialProjectsData as { projects: Project[] }).projects;
		const currentProject = projects.find((p: Project) => p.id === projectId);

		// If project is not found in the active projects list, it's either deleted or doesn't exist
		if (!currentProject) {
			notFound();
		}
	}

	return (
		<UserProvider initialUserData={initialUserData}>
			<SidebarProvider>
				<LastUsedProjectTracker orgId={orgId} projectId={projectId} />
				<DashboardLayoutClient
					initialOrganizationsData={initialOrganizationsData}
					initialProjectsData={initialProjectsData}
					selectedOrgId={orgId}
					selectedProjectId={projectId}
				>
					{children}
				</DashboardLayoutClient>
			</SidebarProvider>
		</UserProvider>
	);
}
