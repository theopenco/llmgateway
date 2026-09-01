import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { LastUsedProjectTracker } from "@/components/last-used-project-tracker";
import CanvasPageClient from "@/components/playground/canvas-page-client";
import { PlaygroundSeoSection } from "@/components/seo/playground-seo-section";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";
import {
	CANVAS_MODEL_COOKIE,
	decodeModelPreference,
} from "@/lib/model-preferences";
import { fetchServerData } from "@/lib/server-api";

import type { Project, Organization } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Canvas — Build UIs from JSON Specs",
	description:
		"Build UIs from JSON specs with live preview, PDF and image export. Part of Lounge by LLM Gateway.",
	alternates: { canonical: "/canvas" },
	openGraph: {
		title: "Canvas — Build UIs from JSON Specs | Lounge",
		description:
			"Build UIs from JSON specs with live preview, PDF and image export. Part of Lounge by LLM Gateway.",
		type: "website",
		url: "https://lounge.llmgateway.io/canvas",
	},
};

export default async function CanvasPage({
	searchParams,
}: {
	searchParams: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await searchParams;
	const cookieStore = await cookies();
	const initialModelPreference = decodeModelPreference(
		cookieStore.get(CANVAS_MODEL_COOKIE)?.value,
	);

	const [models, providers, initialOrganizationsData, orgIdProjectsData] =
		await Promise.all([
			fetchModels(),
			fetchProviders(),
			// Ensure the dedicated Chat org exists, then list it so it can back the
			// default billing context for the playground.
			fetchServerData("GET", "/playground/chat-org").then(() =>
				fetchServerData("GET", "/orgs", {
					params: { query: { includeChat: "true" } },
				}),
			),
			orgId
				? fetchServerData("GET", "/orgs/{id}/projects", {
						params: {
							path: {
								id: orgId,
							},
						},
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
	// The Chat org backs the default billing context and must not appear in the
	// dashboard org switcher.
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

	const projects = (initialProjectsData?.projects ?? []) as Project[];

	let selectedProject: Project | null = null;
	if (projectId) {
		selectedProject = projects.find((p) => p.id === projectId) ?? null;
		if (!selectedProject) {
			notFound();
		}
	} else if (selectedOrganization?.id) {
		const cookieName = `llmgateway-last-used-project-${selectedOrganization.id}`;
		const lastUsed = cookieStore.get(cookieName)?.value;
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
			<PlaygroundSeoSection variant="canvas" />
			<CanvasPageClient
				models={models}
				providers={providers}
				organizations={organizations}
				selectedOrganization={selectedOrganization}
				projects={projects}
				selectedProject={selectedProject}
				initialModelPreference={initialModelPreference}
			/>
		</>
	);
}
