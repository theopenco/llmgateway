import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	title: "Web Search Models - AI Models with Internet Access | LLM Gateway",
	description:
		"Browse and compare AI models with built-in web search capabilities. Get real-time information and grounded responses from the internet.",
	openGraph: {
		title: "Web Search Models - AI Models with Internet Access",
		description:
			"Browse and compare AI models with native web search. Get real-time, grounded responses from the internet.",
		type: "website",
	},
};

export default async function WebSearchModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<Suspense>
			<AllModels
				models={models}
				providers={providers}
				title="Web Search Models"
				description="Models with built-in web search for real-time, internet-grounded responses"
				categoryFilter="web-search"
			>
				<HeroRSC navbarOnly sticky={false} />
			</AllModels>
		</Suspense>
	);
}
