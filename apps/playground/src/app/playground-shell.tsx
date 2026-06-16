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
	const allOrganizations = (
		initialOrganizationsData &&
		typeof initialOrganizationsData === "object" &&
		"organizations" in initialOrganizationsData
			? (initialOrganizationsData as { organizations: Organization[] })
					.organizations
			: []
	) as Organization[];

	const organizations = allOrganizations.filter(
		(o) => !o.isPersonal && !o.isChat,
	);

	// The Chat plan context is only the right default for subscribers (or users
	// who topped up the Chat org). Unsubscribed users with a funded dashboard
	// org land on that org instead; the Chat plan context stays the default only
	// when no org has credits, so the plan upsell can take over. Runs before the
	// chat-org fetch so redirected users never get a Chat org provisioned.
	if (!orgId && !orgShareView) {
		const chatPlanStatusData = await fetchServerData(
			"GET",
			"/chat-plans/status",
		);
		const chatPlanStatus =
			chatPlanStatusData &&
			typeof chatPlanStatusData === "object" &&
			"chatPlan" in chatPlanStatusData
				? (chatPlanStatusData as { chatPlan: string; regularCredits: string })
				: null;
		const hasChatPlanAccess =
			!chatPlanStatus ||
			chatPlanStatus.chatPlan !== "none" ||
			Number(chatPlanStatus.regularCredits) > 0;
		if (!hasChatPlanAccess) {
			const fundedOrganization = organizations.find(
				(o) => Number(o.credits) > 0,
			);
			if (fundedOrganization) {
				const nextParams = new URLSearchParams();
				for (const [key, value] of Object.entries(searchParams)) {
					if (typeof value === "string") {
						nextParams.set(key, value);
					}
				}
				nextParams.set("orgId", fundedOrganization.id);
				redirect(`/?${nextParams.toString()}`);
			}
		}
	}

	// The dedicated Chat org backs the "Personal" context
	// (selectedOrganization === null): generation, billing, and top-ups all run
	// under it. It is created on demand and never appears in the org switcher,
	// which lists real dashboard orgs for shared-chat views only.
	const chatOrgData = await fetchServerData("GET", "/playground/chat-org");
	const chatOrg =
		chatOrgData &&
		typeof chatOrgData === "object" &&
		"organizationId" in chatOrgData
			? (chatOrgData as { organizationId: string; projectId: string })
			: null;

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

	// Personal context (no org selected): generation + billing run under the
	// dedicated Chat org, so resolve its project instead of falling back to the
	// first dashboard org — that fallback silently billed the wrong organization.
	const projectOrgId =
		selectedOrganization?.id ?? chatOrg?.organizationId ?? null;

	if (!initialProjectsData && projectOrgId) {
		try {
			initialProjectsData = (await fetchServerData(
				"GET",
				"/orgs/{id}/projects",
				{
					params: {
						path: {
							id: projectOrgId,
						},
					},
				},
			)) as { projects: Project[] };
		} catch (error) {
			console.warn(
				"Failed to fetch projects for organization:",
				projectOrgId,
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
	} else if (projectOrgId) {
		const cookieName = `llmgateway-last-used-project-${projectOrgId}`;
		const lastUsed = cookieStore.get(cookieName)?.value;
		if (lastUsed) {
			selectedProject = projects.find((p) => p.id === lastUsed) ?? null;
		}
	}
	// In the personal (chat) context, prefer the chat org's resolved project.
	if (!selectedProject && !selectedOrganization && chatOrg) {
		selectedProject = projects.find((p) => p.id === chatOrg.projectId) ?? null;
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
			{projectOrgId && selectedProject?.id ? (
				<LastUsedProjectTracker
					orgId={projectOrgId}
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
