import { cookies } from "next/headers";

import { LastUsedProjectTracker } from "@/components/last-used-project-tracker";
import DecisionsPageClient from "@/components/playground/decisions-page-client";
import { PlaygroundSeoSection } from "@/components/seo/playground-seo-section";
import { decisionModels } from "@/lib/decision-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";
import {
	DECISIONS_MODEL_COOKIE,
	decodeModelPreference,
} from "@/lib/model-preferences";
import { pageTitle } from "@/lib/page-title";
import { resolvePlaygroundContext } from "@/lib/resolve-playground-context";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: pageTitle("Decision Studio — Typed Answers with Probabilities"),
	description:
		"Run decision models in Lounge. Ask yes/no, pick-one, and rating questions about any text or image and get calibrated probabilities instead of prose.",
	alternates: { canonical: "/decisions" },
	openGraph: {
		title: "Decision Studio — Typed Answers with Probabilities | Lounge",
		description:
			"Run decision models in Lounge. Ask yes/no, pick-one, and rating questions about any text or image and get calibrated probabilities instead of prose.",
		type: "website",
		url: "https://lounge.llmgateway.io/decisions",
	},
};

export default async function DecisionsPage({
	searchParams,
}: {
	searchParams: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await searchParams;
	const cookieStore = await cookies();
	const initialModelPreference = decodeModelPreference(
		cookieStore.get(DECISIONS_MODEL_COOKIE)?.value,
	);

	const [
		models,
		providers,
		{ organizations, selectedOrganization, selectedProject },
	] = await Promise.all([
		fetchModels(),
		fetchProviders(),
		resolvePlaygroundContext({ orgId, projectId, cookieStore }),
	]);

	if (!selectedOrganization) {
		return <PlaygroundSeoSection variant="decisions" />;
	}

	return (
		<>
			{selectedProject?.id ? (
				<LastUsedProjectTracker
					orgId={selectedOrganization.id}
					projectId={selectedProject.id}
				/>
			) : null}
			<DecisionsPageClient
				models={decisionModels(models)}
				providers={providers}
				organizations={organizations}
				selectedOrganization={selectedOrganization}
				selectedProject={selectedProject}
				initialModelPreference={initialModelPreference}
			/>
		</>
	);
}
