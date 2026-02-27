import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	title: "Image-to-Image Models - AI Image Editing | LLM Gateway",
	description:
		"Browse and compare AI models that accept images as input and generate new images. Perfect for image editing, style transfer, and visual transformation.",
	openGraph: {
		title: "Image-to-Image Models - AI Image Editing",
		description:
			"Browse and compare AI models for image-to-image generation. Edit, transform, and enhance images with AI.",
		type: "website",
	},
};

export default async function ImageToImageModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<Suspense>
			<AllModels
				models={models}
				providers={providers}
				title="Image-to-Image Models"
				description="Models that accept images as input and generate new images — for editing, style transfer, and visual transformation"
				categoryFilter="image-to-image"
			>
				<HeroRSC navbarOnly sticky={false} />
			</AllModels>
		</Suspense>
	);
}
