import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	title: "Text-to-Image Models - AI Image Generation | LLM Gateway",
	description:
		"Browse and compare AI image generation models like DALL-E, Flux, and more. Generate images from text prompts with multiple providers.",
	openGraph: {
		title: "Text-to-Image Models - AI Image Generation",
		description:
			"Browse and compare AI image generation models. Generate images from text prompts with multiple providers.",
		type: "website",
	},
};

export default async function TextToImageModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<Suspense>
			<AllModels
				models={models}
				providers={providers}
				title="Text-to-Image Models"
				description="Models that generate images from text prompts"
				categoryFilter="text-to-image"
			>
				<HeroRSC navbarOnly sticky={false} />
			</AllModels>
		</Suspense>
	);
}
