import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	title: "Vision Models - AI Models with Image Understanding | LLM Gateway",
	description:
		"Browse and compare AI models with vision capabilities. Analyze images, extract text, describe visuals, and more with multimodal LLMs.",
	openGraph: {
		title: "Vision Models - AI Models with Image Understanding",
		description:
			"Browse and compare AI models with vision capabilities. Analyze images, extract text, and describe visuals.",
		type: "website",
	},
};

export default async function VisionModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<Suspense>
			<AllModels
				models={models}
				providers={providers}
				title="Vision Models"
				description="Models with image understanding capabilities — analyze, describe, and extract information from images"
				categoryFilter="vision"
			>
				<HeroRSC navbarOnly sticky={false} />
			</AllModels>
		</Suspense>
	);
}
