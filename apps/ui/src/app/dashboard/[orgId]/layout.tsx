import { DashboardLayoutClient } from "@/components/dashboard/dashboard-layout-client";
import { UnauthorizedView } from "@/components/dashboard/unauthorized-view";
import { UserProvider } from "@/components/providers/user-provider";
import { SidebarProvider } from "@/lib/components/sidebar";
import { getLastUsedProjectId } from "@/lib/last-used-project-server";
import { fetchServerData } from "@/lib/server-api";

import type { AnnouncementEntry } from "@/components/dashboard/changelog-notifications";
import type { User, Organization, Project } from "@/lib/types";
import type { Blog, Changelog } from "content-collections";
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

	const initialOrganizationsData = await fetchServerData<{
		organizations: Organization[];
	}>("GET", "/orgs");

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

	// Fetch recent changelog + blog entries for the notifications bell
	let announcementEntries: AnnouncementEntry[] = [];
	try {
		const { allChangelogs, allBlogs } = await import("content-collections");

		const changelogs: AnnouncementEntry[] = allChangelogs
			.filter((entry: Changelog) => !entry?.draft)
			.map((entry: Changelog) => ({
				slug: entry.slug,
				title: entry.title,
				summary: entry.summary,
				date: entry.date,
				type: "changelog" as const,
			}));

		const blogs: AnnouncementEntry[] = allBlogs
			.filter((entry: Blog) => !entry?.draft)
			.map((entry: Blog) => ({
				slug: entry.slug,
				title: entry.title,
				summary: entry.summary,
				date: entry.date,
				type: "blog" as const,
			}));

		announcementEntries = [...changelogs, ...blogs]
			.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
			.slice(0, 8);
	} catch {
		// Content collections may not be available during build
	}

	return (
		<UserProvider initialUserData={initialUserData}>
			<SidebarProvider>
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
