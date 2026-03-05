import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	title: "Text Generation Models - Compare LLM Models | LLM Gateway",
	description:
		"Browse and compare text generation AI models from OpenAI, Anthropic, Google, and more. Find the best LLM for chat, code, and content generation.",
	openGraph: {
		title: "Text Generation Models - Compare LLM Models",
		description:
			"Browse and compare text generation AI models from leading providers. Filter by pricing, context size, and capabilities.",
		type: "website",
	},
};

export default async function TextModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<Suspense>
			<AllModels
				models={models}
				providers={providers}
				title="Text Generation Models"
				description="Models designed for text generation, chat, code, and content creation"
				categoryFilter="text"
			>
				<HeroRSC navbarOnly sticky={false} />
			</AllModels>
		</Suspense>
	);
}
