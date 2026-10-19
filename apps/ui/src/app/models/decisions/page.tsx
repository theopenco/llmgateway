import { Suspense } from "react";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	alternates: {
		canonical: "https://llmgateway.io/models/decisions",
	},
	title: "Decision Models - Typed AI Decisions API",
	description:
		"Browse and compare AI decision models for classification, routing, ranking and grading. Get typed, probabilistic answers through one OpenAI-compatible /v1/decisions API.",
	openGraph: {
		title: "Decision Models - Typed AI Decisions API",
		description:
			"Browse and compare AI decision models for classification, routing, ranking and grading through one OpenAI-compatible API.",
		type: "website",
	},
};

export default async function DecisionModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<Suspense>
			<AllModels
				footer={<Footer />}
				models={models}
				providers={providers}
				title="Decision Models"
				description="Models that return typed, probabilistic decisions instead of generated text"
				categoryFilter="decisions"
			>
				<HeroRSC sticky={false} />
			</AllModels>
		</Suspense>
	);
}
