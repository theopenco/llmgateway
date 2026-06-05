import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { LastUsedProjectTracker } from "@/components/last-used-project-tracker";
import ChatPageClient from "@/components/playground/chat-page-client";
import OrgPageClient from "@/components/playground/org-page-client";
import { PlaygroundSeoSection } from "@/components/seo/playground-seo-section";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";
import {
	CHAT_MODEL_COOKIE,
	decodeModelPreference,
} from "@/lib/model-preferences";
import { fetchServerData } from "@/lib/server-api";

import type { Organization, Project } from "@/lib/types";

export interface GatewayModel {
	id: string;
	name?: string;
	architecture?: { input_modalities?: string[] };
}

export interface PlaygroundSearchParams {
	orgId?: string;
	projectId?: string;
	q?: string;
	hints?: string;
	model?: string;
}

export interface OrgShareView {
	organizationId: string;
	shareId?: string;
}

interface RenderPlaygroundShellOptions {
	searchParams: PlaygroundSearchParams;
	orgShareView?: OrgShareView;
}

export async function renderPlaygroundShell({
	searchParams,
	orgShareView,
}: RenderPlaygroundShellOptions) {
	const { q, hints } = searchParams;
	const orgId = orgShareView?.organizationId ?? searchParams.orgId;
	const { projectId } = searchParams;
	let { model } = searchParams;
	const cookieStore = await cookies();
	const initialModelPreference = decodeModelPreference(
		cookieStore.get(CHAT_MODEL_COOKIE)?.value,
	);

	if (hints === "search" && !model) {
		model = "google-ai-studio/gemini-3-flash-preview";
		const newParams = new URLSearchParams();
		if (orgId) {
			newParams.set("orgId", orgId);
		}
		if (projectId) {
			newParams.set("projectId", projectId);
		}
		if (q) {
			newParams.set("q", q);
		}
		if (hints) {
			newParams.set("hints", hints);
		}
		newParams.set("model", model);
		redirect(`/?${newParams.toString()}`);
	}

	const initialOrganizationsData = await fetchServerData("GET", "/orgs");
	const organizations = (
		initialOrganizationsData &&
		typeof initialOrganizationsData === "object" &&
		"organizations" in initialOrganizationsData
			? (initialOrganizationsData as { organizations: Organization[] })
					.organizations
			: []
	) as Organization[];

	if (
		orgShareView &&
		!organizations.some((org) => org.id === orgShareView.organizationId)
	) {
		notFound();
	}

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

	if (
		projectId &&
		initialProjectsData &&
		typeof initialProjectsData === "object" &&
		"projects" in initialProjectsData
	) {
		const projects = (initialProjectsData as { projects: Project[] }).projects;
		const currentProject = projects.find((p: Project) => p.id === projectId);

		if (!currentProject) {
			notFound();
		}
	}

	const selectedOrganization =
		(orgId ? organizations.find((o) => o.id === orgId) : null) ?? null;

	const projectOrg = selectedOrganization ?? organizations[0] ?? null;

	if (!initialProjectsData && projectOrg?.id) {
		try {
			initialProjectsData = (await fetchServerData(
				"GET",
				"/orgs/{id}/projects",
				{
					params: {
						path: {
							id: projectOrg.id,
						},
					},
				},
			)) as { projects: Project[] };
		} catch (error) {
			console.warn(
				"Failed to fetch projects for organization:",
				projectOrg?.id,
				error,
			);
		}
	}

	const projects = (initialProjectsData?.projects ?? []) as Project[];
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	let selectedProject: Project | null = null;
	if (projectId) {
		selectedProject = projects.find((p) => p.id === projectId) ?? null;
		if (projectId && !selectedProject && projectId.length > 0) {
			notFound();
		}
	} else if (projectOrg?.id) {
		const cookieName = `llmgateway-last-used-project-${projectOrg.id}`;
		const lastUsed = cookieStore.get(cookieName)?.value;
		if (lastUsed) {
			selectedProject = projects.find((p) => p.id === lastUsed) ?? null;
		}
	}
	selectedProject ??= projects[0] ?? null;

	if (orgShareView) {
		return (
			<OrgPageClient
				organizationId={orgShareView.organizationId}
				shareId={orgShareView.shareId ?? null}
				organizations={organizations}
				selectedOrganization={selectedOrganization}
			/>
		);
	}

	return (
		<>
			{projectOrg?.id && selectedProject?.id ? (
				<LastUsedProjectTracker
					orgId={projectOrg.id}
					projectId={selectedProject.id}
				/>
			) : null}
			<PlaygroundSeoSection variant="chat" />
			<ChatPageClient
				models={models.filter((m) => !m.output?.includes("embedding"))}
				providers={providers}
				organizations={organizations}
				selectedOrganization={selectedOrganization}
				projects={projects}
				selectedProject={selectedProject}
				initialPrompt={q}
				enableWebSearch={hints === "search"}
				initialModelPreference={initialModelPreference}
			/>
		</>
	);
}
