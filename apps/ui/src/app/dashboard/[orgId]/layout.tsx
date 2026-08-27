import { cookies } from "next/headers";

import { DashboardLayoutClient } from "@/components/dashboard/dashboard-layout-client";
import { UnauthorizedView } from "@/components/dashboard/unauthorized-view";
import { UserProvider } from "@/components/providers/user-provider";
import { getAnnouncementEntries } from "@/lib/announcements";
import { SidebarProvider } from "@/lib/components/sidebar";
import { getLastUsedProjectId } from "@/lib/last-used-project-server";
import { getOrganizations, getOrgProjects, getUserMe } from "@/lib/server-api";

import type { Project } from "@/lib/types";
import type { ReactNode } from "react";

interface OrgLayoutProps {
	children: ReactNode;
	params: Promise<{ orgId: string }>;
}

export default async function OrgLayout({ children, params }: OrgLayoutProps) {
	const { orgId } = await params;

	const initialUserDataPromise = getUserMe();

	const initialOrganizationsDataPromise = getOrganizations();

	const initialProjectsDataPromise = orgId ? getOrgProjects(orgId) : null;

	const [initialUserData, initialOrganizationsData] = await Promise.all([
		initialUserDataPromise,
		initialOrganizationsDataPromise,
	]);

	const orgs = initialOrganizationsData?.organizations ?? [];
	const isAuthorizedForOrg = orgs.some((org) => org.id === orgId);

	if (orgId && !isAuthorizedForOrg) {
		return (
			<UserProvider initialUserData={initialUserData}>
				<UnauthorizedView resource="organization" />
			</UserProvider>
		);
	}

	let initialProjectsData = null;
	let lastUsedProjectId: string | undefined;

	if (orgId) {
		try {
			initialProjectsData = await initialProjectsDataPromise;

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

	// Recent changelog + blog entries for the notifications bell
	const announcementEntries = await getAnnouncementEntries();

	const cookieStore = await cookies();
	const sidebarDefaultOpen =
		cookieStore.get("sidebar_state")?.value !== "false";

	return (
		<UserProvider initialUserData={initialUserData}>
			<SidebarProvider defaultOpen={sidebarDefaultOpen}>
				<DashboardLayoutClient
					initialOrganizationsData={initialOrganizationsData}
					initialProjectsData={initialProjectsData}
					selectedOrgId={orgId}
					selectedProjectId={lastUsedProjectId}
					announcementEntries={announcementEntries}
				>
					{children}
				</DashboardLayoutClient>
			</SidebarProvider>
		</UserProvider>
	);
}
