import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	title: "Video Generation Models - AI Video Generation",
	description:
		"Browse and compare AI video generation models like Sora, Veo, and more. Generate videos from text prompts with multiple providers.",
	openGraph: {
		title: "Video Generation Models - AI Video Generation",
		description:
			"Browse and compare AI video generation models. Generate videos from text prompts with multiple providers.",
		type: "website",
	},
};

export default async function VideoModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<Suspense>
			<AllModels
				models={models}
				providers={providers}
				title="Video Generation Models"
				description="Models that generate videos from text prompts"
				categoryFilter="video"
			>
				<HeroRSC navbarOnly sticky={false} />
			</AllModels>
		</Suspense>
	);
}
