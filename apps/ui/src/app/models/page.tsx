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
	{ href: "/models/premium", label: "Premium models" },
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
		"Browse and compare 200+ AI models from OpenAI, Anthropic, Google, and 40+ providers. Filter by capability, price, and context — call any model via one API.",
	openGraph: {
		title: "AI Models Directory — Compare 200+ LLM Models",
		description:
			"Browse and compare 200+ AI models from OpenAI, Anthropic, Google, and 40+ providers. Filter by capability, price, and context — call any model via one API.",
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

	// Standalone top-level ItemList (referenced by the CollectionPage via @id)
	// so parsers that only inspect top-level @type values still see the list.
	const itemListSchema = {
		"@context": "https://schema.org",
		"@type": "ItemList",
		"@id": "https://llmgateway.io/models#model-list",
		name: "AI Models Directory",
		numberOfItems: models.length,
		itemListElement: models.map((model, index) => ({
			"@type": "ListItem",
			position: index + 1,
			url: `https://llmgateway.io/models/${encodeURIComponent(model.id)}`,
			name: model.name ?? model.id,
		})),
	};

	const collectionSchema = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		name: "AI Models Directory",
		description:
			"Browse and compare 200+ AI models from leading providers like OpenAI, Anthropic, and Google. Filter by capabilities, pricing, and context size.",
		url: "https://llmgateway.io/models",
		mainEntity: { "@id": "https://llmgateway.io/models#model-list" },
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
			<JsonLd data={[collectionSchema, itemListSchema, breadcrumbSchema]} />
			<Suspense>
				<AllModels
					models={models}
					providers={providers}
					title="AI Models Directory"
					description="Browse and compare 200+ AI models from OpenAI, Anthropic, Google, and 40+ providers — filter by capabilities, pricing, and context size."
					seoContent={
						<>
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
							<section className="container mx-auto px-4 pb-16">
								<div className="grid gap-x-12 gap-y-10 md:grid-cols-3 max-w-6xl">
									<div>
										<h2 className="text-2xl font-bold mb-4">
											How to choose an AI model
										</h2>
										<p className="text-muted-foreground leading-relaxed">
											Start from the capability you need — reasoning, vision,
											tool calling, or long context — then compare price per
											million tokens and context window. The filters above
											narrow the directory, and each model&apos;s page lists
											provider availability, live pricing, and uptime. Not sure
											where to start? See which models developers actually run
											in production in the{" "}
											<Link
												href="/rankings"
												className="text-foreground underline underline-offset-4"
											>
												live rankings
											</Link>
											.
										</p>
									</div>
									<div>
										<h2 className="text-2xl font-bold mb-4">
											Compare AI model pricing
										</h2>
										<p className="text-muted-foreground leading-relaxed">
											Prices are shown per million input and output tokens,
											exactly as providers publish them. Sort by price to find
											the{" "}
											<Link
												href="/models/cheapest"
												className="text-foreground underline underline-offset-4"
											>
												cheapest models
											</Link>
											, or estimate a monthly bill for your traffic with the{" "}
											<Link
												href="/token-cost-calculator"
												className="text-foreground underline underline-offset-4"
											>
												token cost calculator
											</Link>
											.
										</p>
									</div>
									<div>
										<h2 className="text-2xl font-bold mb-4">
											Try a model before you integrate
										</h2>
										<p className="text-muted-foreground leading-relaxed">
											Every model here is callable through one OpenAI-compatible
											API — switch models by changing a single string. Chat with
											any of them first in the{" "}
											<a
												href="https://lounge.llmgateway.io"
												className="text-foreground underline underline-offset-4"
											>
												Lounge
											</a>{" "}
											to compare quality, speed, and cost side by side.
										</p>
									</div>
								</div>
							</section>
						</>
					}
				>
					<HeroRSC navbarOnly sticky={false} />
				</AllModels>
			</Suspense>
		</>
	);
}
