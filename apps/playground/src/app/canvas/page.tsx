import { cookies } from "next/headers";

import { LastUsedProjectTracker } from "@/components/last-used-project-tracker";
import CanvasPageClient from "@/components/playground/canvas-page-client";
import { PlaygroundSeoSection } from "@/components/seo/playground-seo-section";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";
import {
	CANVAS_MODEL_COOKIE,
	decodeModelPreference,
} from "@/lib/model-preferences";
import { resolvePlaygroundContext } from "@/lib/resolve-playground-context";

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

	const [
		models,
		providers,
		{
			organizations,
			selectedOrganization,
			projects,
			selectedProject,
			projectsLoadFailed,
		},
	] = await Promise.all([
		fetchModels(),
		fetchProviders(),
		resolvePlaygroundContext({
			orgId,
			projectId,
			cookieStore,
			projectIdRequiresOrgId: true,
		}),
	]);

	if (!selectedOrganization) {
		return <PlaygroundSeoSection variant="canvas" />;
	}

	return (
		<>
			{selectedProject?.id ? (
				<LastUsedProjectTracker
					orgId={selectedOrganization.id}
					projectId={selectedProject.id}
				/>
			) : null}
			<CanvasPageClient
				models={models}
				providers={providers}
				organizations={organizations}
				selectedOrganization={selectedOrganization}
				projects={projects}
				selectedProject={selectedProject}
				projectsLoadFailed={projectsLoadFailed}
				initialModelPreference={initialModelPreference}
			/>
		</>
	);
}
