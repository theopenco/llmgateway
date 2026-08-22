import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { LastUsedProjectTracker } from "@/components/last-used-project-tracker";
import ChatPageClient from "@/components/playground/chat-page-client";
import OrgPageClient from "@/components/playground/org-page-client";
import { LoungeLandingSections } from "@/components/seo/lounge-landing-sections";
import { PlaygroundSeoSection } from "@/components/seo/playground-seo-section";
import { CHAT_CONTEXT_COOKIE } from "@/lib/constants";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";
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

	// Start the model catalogue fetches immediately — they don't depend on any
	// of the org/billing lookups below, so they resolve while those run.
	const modelsPromise = fetchModels();
	const providersPromise = fetchProviders();

	const shouldCheckChatPlan =
		!orgId && !orgShareView && !cookieStore.get(CHAT_CONTEXT_COOKIE);

	// /orgs, the chat-plan status, and the orgId-scoped projects list are
	// mutually independent (the projects fetch only happens with an orgId, the
	// plan check only without one), so resolve them in one round trip. Only the
	// chat-org fetch below must stay sequenced after the plan-redirect check.
	const [initialOrganizationsData, chatPlanStatusData, eagerProjectsData] =
		await Promise.all([
			fetchServerData("GET", "/orgs"),
			shouldCheckChatPlan ? fetchServerData("GET", "/chat-plans/status") : null,
			orgId
				? fetchServerData("GET", "/orgs/{id}/projects", {
						params: {
							path: {
								id: orgId,
							},
						},
					}).catch((error) => {
						console.warn(
							"Failed to fetch projects for organization:",
							orgId,
							error,
						);
						return null;
					})
				: null,
		]);
	const allOrganizations = (
		initialOrganizationsData &&
		typeof initialOrganizationsData === "object" &&
		"organizations" in initialOrganizationsData
			? (initialOrganizationsData as { organizations: Organization[] })
					.organizations
			: []
	) as Organization[];

	const organizations = allOrganizations.filter((o) => o.kind === "default");

	// The Chat plan context is only the right default for subscribers (or users
	// who topped up the Chat org). Unsubscribed users with a funded dashboard
	// org land on that org instead; the Chat plan context stays the default only
	// when no org has credits, so the plan upsell can take over. Runs before the
	// chat-org fetch so redirected users never get a Chat org provisioned.
	// Skipped when the user explicitly picked the Chat plan context in the org
	// switcher (cookie) — this fallback must not override an explicit choice.
	if (shouldCheckChatPlan) {
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

	let initialProjectsData = eagerProjectsData as {
		projects: Project[];
	} | null;

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
		modelsPromise,
		providersPromise,
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

	// The chat org is provisioned on demand for every signed-in user, so its
	// absence is a cheap signed-out signal (no extra request). Signed-out
	// visitors — which includes crawlers — get the visible landing sections
	// below the app; members keep the clean full-viewport chat.
	const isMember = chatOrg !== null;

	return (
		<>
			{projectOrgId && selectedProject?.id ? (
				<LastUsedProjectTracker
					orgId={projectOrgId}
					projectId={selectedProject.id}
				/>
			) : null}
			{isMember ? <PlaygroundSeoSection variant="chat" /> : null}
			<ChatPageClient
				models={models.filter(
					(m) =>
						!m.output?.includes("embedding") && !m.output?.includes("rerank"),
				)}
				providers={providers}
				organizations={organizations}
				selectedOrganization={selectedOrganization}
				projects={projects}
				selectedProject={selectedProject}
				initialPrompt={q}
				enableWebSearch={hints === "search"}
			/>
			{isMember ? null : <LoungeLandingSections />}
		</>
	);
}
