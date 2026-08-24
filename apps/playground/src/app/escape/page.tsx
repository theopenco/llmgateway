import { cookies } from "next/headers";

import { EscapeClient } from "@/components/escape/escape-client";
import { LastUsedProjectTracker } from "@/components/last-used-project-tracker";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";
import {
	decodeModelPreference,
	ESCAPE_MODEL_COOKIE,
} from "@/lib/model-preferences";
import { fetchServerData } from "@/lib/server-api";

import {
	ESCAPE_FIRST_LEVEL_ID,
	isValidLevelId,
} from "@llmgateway/shared/sandbox-escape";

import type { Organization, Project } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Sandbox Escape — Can Your LLM Break Out?",
	description:
		"Pick a model and watch it try to escape a sandboxed container, one billed API call per move. Five levels, a public leaderboard, and a shareable result. Part of Lounge by LLM Gateway.",
	alternates: { canonical: "/escape" },
	openGraph: {
		title: "Sandbox Escape — Can Your LLM Break Out?",
		description:
			"Every model gets the same five maps. One API call per step. See which one actually escapes.",
		url: "/escape",
	},
};

export default async function EscapePage({
	searchParams,
}: {
	searchParams: Promise<{ orgId?: string; projectId?: string; level?: string }>;
}) {
	const { orgId, projectId, level } = await searchParams;
	const cookieStore = await cookies();
	const initialModelPreference = decodeModelPreference(
		cookieStore.get(ESCAPE_MODEL_COOKIE)?.value,
	);

	const requestedLevel = Number(level);
	const initialLevelId = isValidLevelId(requestedLevel)
		? requestedLevel
		: ESCAPE_FIRST_LEVEL_ID;

	const [models, providers, initialOrganizationsData, orgIdProjectsData] =
		await Promise.all([
			fetchModels(),
			fetchProviders(),
			// Chained, not parallel: the first call's response is discarded and it is
			// made purely for its side effect of creating the Chat organization,
			// which must exist before the org list is read.
			fetchServerData("GET", "/playground/chat-org").then(() =>
				fetchServerData("GET", "/orgs", {
					params: { query: { includeChat: "true" } },
				}),
			),
			orgId
				? fetchServerData("GET", "/orgs/{id}/projects", {
						params: { path: { id: orgId } },
					})
				: null,
		]);

	let initialProjectsData = (orgIdProjectsData ?? null) as {
		projects: Project[];
	} | null;

	const allOrganizations = (
		initialOrganizationsData &&
		typeof initialOrganizationsData === "object" &&
		"organizations" in initialOrganizationsData
			? (initialOrganizationsData as { organizations: Organization[] })
					.organizations
			: []
	) as Organization[];
	const chatOrg = allOrganizations.find((o) => o.kind === "chat") ?? null;
	const organizations = allOrganizations.filter((o) => o.kind === "default");
	const selectedOrganization =
		(orgId ? organizations.find((o) => o.id === orgId) : null) ??
		chatOrg ??
		organizations[0] ??
		null;

	if (!initialProjectsData && selectedOrganization?.id) {
		try {
			initialProjectsData = (await fetchServerData(
				"GET",
				"/orgs/{id}/projects",
				{ params: { path: { id: selectedOrganization.id } } },
			)) as { projects: Project[] };
		} catch (error) {
			console.warn(
				"Failed to fetch projects for organization:",
				selectedOrganization?.id,
				error,
			);
		}
	}

	const projects = (initialProjectsData?.projects ?? []) as Project[];

	let selectedProject: Project | null = null;
	if (projectId) {
		selectedProject = projects.find((p) => p.id === projectId) ?? null;
	} else if (selectedOrganization?.id) {
		const lastUsed = cookieStore.get(
			`llmgateway-last-used-project-${selectedOrganization.id}`,
		)?.value;
		if (lastUsed) {
			selectedProject = projects.find((p) => p.id === lastUsed) ?? null;
		}
	}
	selectedProject ??= projects[0] ?? null;

	return (
		<>
			{selectedOrganization?.id && selectedProject?.id ? (
				<LastUsedProjectTracker
					orgId={selectedOrganization.id}
					projectId={selectedProject.id}
				/>
			) : null}
			<EscapeClient
				models={models}
				providers={providers}
				selectedOrganization={selectedOrganization}
				projects={projects}
				selectedProject={selectedProject}
				initialModelPreference={initialModelPreference}
				initialLevelId={initialLevelId}
			/>
		</>
	);
}
