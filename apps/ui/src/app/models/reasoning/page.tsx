import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	title: "Reasoning Models - AI Models for Complex Analysis | LLM Gateway",
	description:
		"Browse and compare AI reasoning models like o1, o3, DeepSeek-R1, and more. Advanced chain-of-thought models for complex problem solving.",
	openGraph: {
		title: "Reasoning Models - AI Models for Complex Analysis",
		description:
			"Browse and compare AI reasoning models. Advanced chain-of-thought models for complex problem solving and analysis.",
		type: "website",
	},
};

export default async function ReasoningModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<Suspense>
			<AllModels
				models={models}
				providers={providers}
				title="Reasoning Models"
				description="Advanced chain-of-thought models for complex problem solving and analysis"
				categoryFilter="reasoning"
			>
				<HeroRSC navbarOnly sticky={false} />
			</AllModels>
		</Suspense>
	);
}
