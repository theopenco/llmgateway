import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { LastUsedProjectTracker } from "@/components/last-used-project-tracker";
import ChatPageClient from "@/components/playground/chat-page-client";
import { fetchServerData } from "@/lib/server-api";

import { models, providers } from "@llmgateway/models";

import type { Project, Organization } from "@/lib/types";

export interface GatewayModel {
	id: string;
	name?: string;
	architecture?: { input_modalities?: string[] };
}

export const dynamic = "force-dynamic";

export default async function ChatPage({
	searchParams,
}: {
	searchParams: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await searchParams;

	// Fetch organizations server-side
	const initialOrganizationsData = await fetchServerData("GET", "/orgs");

	// Fetch projects for the specific organization (if provided)
	let initialProjectsData: { projects: Project[] } | null = null;
	if (orgId) {
		try {
			initialProjectsData = (await fetchServerData(
				"GET",
				"/orgs/{id}/projects",
				{
					params: {
						path: {
							id: orgId,
						},
					},
				},
			)) as { projects: Project[] };
		} catch (error) {
			console.warn("Failed to fetch projects for organization:", orgId, error);
		}
	}

	// Validate that the project exists and is not deleted (if explicitly provided)
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

	const organizations = (
		initialOrganizationsData &&
		typeof initialOrganizationsData === "object" &&
		"organizations" in initialOrganizationsData
			? (initialOrganizationsData as { organizations: Organization[] })
					.organizations
			: []
	) as Organization[];
	const selectedOrganization =
		(orgId ? organizations.find((o) => o.id === orgId) : organizations[0]) ??
		null;

	// Ensure we have projects for the selected organization (when orgId not provided)
	if (!initialProjectsData && selectedOrganization?.id) {
		try {
			initialProjectsData = (await fetchServerData(
				"GET",
				"/orgs/{id}/projects",
				{
					params: {
						path: {
							id: selectedOrganization.id,
						},
					},
				},
			)) as { projects: Project[] };
		} catch (error) {
			console.warn(
				"Failed to fetch projects for organization:",
				selectedOrganization?.id,
				error,
			);
		}
	}

	const projects = (initialProjectsData?.projects || []) as Project[];

	// Determine selected project: URL > cookie > first
	let selectedProject: Project | null = null;
	if (projectId) {
		selectedProject = projects.find((p) => p.id === projectId) || null;
		if (projectId && !selectedProject && projectId.length > 0) {
			notFound();
		}
	} else if (selectedOrganization?.id) {
		const cookieStore = await cookies();
		const cookieName = `llmgateway-last-used-project-${selectedOrganization.id}`;
		const lastUsed = cookieStore.get(cookieName)?.value;
		if (lastUsed) {
			selectedProject = projects.find((p) => p.id === lastUsed) || null;
		}
	}
	if (!selectedProject) {
		selectedProject = projects[0] || null;
	}

	return (
		<>
			{selectedOrganization?.id && selectedProject?.id ? (
				<LastUsedProjectTracker
					orgId={selectedOrganization.id}
					projectId={selectedProject.id}
				/>
			) : null}
			<ChatPageClient
				models={models}
				providers={providers}
				organizations={organizations}
				selectedOrganization={selectedOrganization}
				projects={projects}
				selectedProject={selectedProject}
			/>
		</>
	);
}
