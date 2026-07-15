import Link from "next/link";
import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { JsonLd } from "@/components/seo/json-ld";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

const CATEGORY_LINKS: ReadonlyArray<{ href: string; label: string }> = [
	{ href: "/models/coding", label: "Best models for coding" },
	{ href: "/models/reasoning", label: "Reasoning models" },
	{ href: "/models/roleplay", label: "Best models for roleplay" },
	{ href: "/models/creative-writing", label: "Creative writing models" },
	{ href: "/models/translation", label: "Translation models" },
	{ href: "/models/math", label: "Best models for math" },
	{ href: "/models/long-context", label: "Long context models" },
	{ href: "/models/cheapest", label: "Cheapest models" },
	{ href: "/models/open-source", label: "Open source models" },
	{ href: "/models/vision", label: "Vision models" },
	{ href: "/models/tools", label: "Tool-calling models" },
	{ href: "/models/web-search", label: "Web search models" },
	{ href: "/models/embeddings", label: "Embedding models" },
	{ href: "/models/text", label: "Text generation models" },
	{ href: "/models/text-to-image", label: "Text-to-image models" },
	{ href: "/models/image-to-image", label: "Image editing models" },
	{ href: "/models/video", label: "Video generation models" },
	{ href: "/models/discounted", label: "Discounted models" },
];

export const metadata = {
	alternates: {
		canonical: "https://llmgateway.io/models",
	},
	title: "AI Models Directory — Compare 200+ LLM Models",
	description:
		"Browse and compare 200+ AI models from OpenAI, Anthropic, Google, and more. Filter by capabilities, pricing, and context size.",
	openGraph: {
		title: "AI Models Directory — Compare 200+ LLM Models",
		description:
			"Browse and compare 200+ AI models from OpenAI, Anthropic, Google, and more. Filter by capabilities, pricing, and context size.",
		type: "website",
		url: "https://llmgateway.io/models",
	},
	twitter: {
		card: "summary_large_image",
		title: "AI Models Directory — Compare 200+ LLM Models",
		description:
			"Browse and compare 200+ AI models from leading providers. Filter by capabilities, pricing, and context size.",
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
			"Browse and compare 200+ AI models from leading providers like OpenAI, Anthropic, and Google. Filter by capabilities, pricing, and context size.",
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
					description="Browse and compare 200+ AI models from OpenAI, Anthropic, Google, and 40+ providers — filter by capabilities, pricing, and context size."
					seoContent={
						<section className="container mx-auto px-4 pb-16">
							<h2 className="text-2xl font-bold mb-6">
								Browse models by use case
							</h2>
							<ul className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 max-w-3xl">
								{CATEGORY_LINKS.map((category) => (
									<li key={category.href}>
										<Link
											href={category.href}
											className="text-muted-foreground hover:text-foreground hover:underline underline-offset-4"
										>
											{category.label}
										</Link>
									</li>
								))}
							</ul>
						</section>
					}
				>
					<HeroRSC navbarOnly sticky={false} />
				</AllModels>
			</Suspense>
		</>
	);
}
