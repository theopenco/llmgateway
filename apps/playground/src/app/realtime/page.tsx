import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { LastUsedProjectTracker } from "@/components/last-used-project-tracker";
import RealtimePageClient from "@/components/playground/realtime-page-client";
import { PlaygroundSeoSection } from "@/components/seo/playground-seo-section";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";
import {
	decodeModelPreference,
	REALTIME_MODEL_COOKIE,
	REALTIME_TRANSCRIPTION_MODEL_COOKIE,
} from "@/lib/model-preferences";
import { fetchServerData } from "@/lib/server-api";

import type { Project, Organization } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "AI Voice Calls — Realtime Speech to Speech",
	description:
		"Have live voice conversations with realtime speech-to-speech models. Pick a model and voice, talk naturally, interrupt mid-sentence, and read both transcripts.",
	alternates: { canonical: "/realtime" },
	openGraph: {
		title: "AI Voice Calls — Realtime Speech to Speech | Lounge",
		description:
			"Live voice conversations with realtime speech-to-speech models. Pick a model and voice, interrupt mid-sentence, and read both transcripts.",
		type: "website",
		url: "https://lounge.llmgateway.io/realtime",
	},
};

export default async function RealtimePage({
	searchParams,
}: {
	searchParams: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await searchParams;
	const cookieStore = await cookies();
	const initialModelPreference = decodeModelPreference(
		cookieStore.get(REALTIME_MODEL_COOKIE)?.value,
	);
	const initialTranscriptionModelPreference = decodeModelPreference(
		cookieStore.get(REALTIME_TRANSCRIPTION_MODEL_COOKIE)?.value,
	);

	const [models, providers, initialOrganizationsData, orgIdProjectsData] =
		await Promise.all([
			fetchModels(),
			fetchProviders(),
			fetchServerData("GET", "/orgs"),
			// Start the projects fetch for the URL's org eagerly; it is discarded
			// below when that org doesn't end up selected.
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

	const allOrganizations = (
		initialOrganizationsData &&
		typeof initialOrganizationsData === "object" &&
		"organizations" in initialOrganizationsData
			? (initialOrganizationsData as { organizations: Organization[] })
					.organizations
			: []
	) as Organization[];
	// Realtime calls bill regular PAYG credits only; chat/dev plan
	// organizations cannot back them, so the billing context is scoped to
	// kind === "default" with no Chat-org fallback.
	const organizations = allOrganizations.filter((o) => o.kind === "default");
	const selectedOrganization =
		(orgId ? organizations.find((o) => o.id === orgId) : null) ??
		organizations[0] ??
		null;

	let initialProjectsData: { projects: Project[] } | null =
		selectedOrganization?.id === orgId && orgIdProjectsData
			? (orgIdProjectsData as { projects: Project[] })
			: null;
	if (!selectedOrganization) {
		return <PlaygroundSeoSection variant="realtime" />;
	}

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
				selectedOrganization.id,
				error,
			);
		}
	}

	const projects = (initialProjectsData?.projects ?? []) as Project[];

	let selectedProject: Project | null = null;
	if (projectId) {
		selectedProject = projects.find((p) => p.id === projectId) ?? null;
		if (!selectedProject && projectId.length > 0) {
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
			<RealtimePageClient
				models={models}
				providers={providers}
				organizations={organizations}
				selectedOrganization={selectedOrganization}
				projects={projects}
				selectedProject={selectedProject}
				initialModelPreference={initialModelPreference}
				initialTranscriptionModelPreference={
					initialTranscriptionModelPreference
				}
			/>
		</>
	);
}
