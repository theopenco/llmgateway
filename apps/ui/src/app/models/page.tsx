import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { JsonLd } from "@/components/seo/json-ld";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	title: "AI Models Directory — Compare 280+ LLM Models",
	description:
		"Browse and compare 280+ AI models from leading providers like OpenAI, Anthropic, Google, and more. Filter by capabilities, pricing, and context size. Find the perfect LLM for your application.",
	openGraph: {
		title: "AI Models Directory — Compare 280+ LLM Models",
		description:
			"Browse and compare 280+ AI models from leading providers like OpenAI, Anthropic, Google, and more. Filter by capabilities, pricing, and context size.",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "AI Models Directory — Compare 280+ LLM Models",
		description:
			"Browse and compare 280+ AI models from leading providers. Filter by capabilities, pricing, and context size.",
	},
};

export default async function ModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	const collectionSchema = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		name: "AI Models Directory",
		description:
			"Browse and compare 280+ AI models from leading providers like OpenAI, Anthropic, and Google. Filter by capabilities, pricing, and context size.",
		url: "https://llmgateway.io/models",
		mainEntity: {
			"@type": "ItemList",
			numberOfItems: models.length,
			itemListElement: models.map((model, index) => ({
				"@type": "ListItem",
				position: index + 1,
				url: `https://llmgateway.io/models/${encodeURIComponent(model.id)}`,
				name: model.name ?? model.id,
			})),
		},
	};

	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{
				"@type": "ListItem",
				position: 1,
				name: "Home",
				item: "https://llmgateway.io",
			},
			{
				"@type": "ListItem",
				position: 2,
				name: "Models",
				item: "https://llmgateway.io/models",
			},
		],
	};

	return (
		<>
			<JsonLd data={[collectionSchema, breadcrumbSchema]} />
			<Suspense>
				<AllModels
					models={models}
					providers={providers}
					title="AI Models Directory"
					description="Browse and compare 280+ AI models from OpenAI, Anthropic, Google, and 35+ providers — filter by capabilities, pricing, and context size."
				>
					<HeroRSC navbarOnly sticky={false} />
				</AllModels>
			</Suspense>
		</>
	);
}
