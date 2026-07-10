import { Suspense } from "react";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { ModelComparison } from "@/components/models/model-comparison";
import { JsonLd } from "@/components/seo/json-ld";

export const metadata = {
	title: "Compare AI Models Side by Side",
	description:
		"Select any two AI models to compare pricing, context window, and capabilities with our interactive model comparison tool.",
	alternates: { canonical: "https://llmgateway.io/models/compare" },
	openGraph: {
		title: "AI Model Comparison Tool",
		description:
			"Compare LLM pricing, context, and features across providers in a side-by-side view.",
		type: "website",
		url: "https://llmgateway.io/models/compare",
	},
	twitter: {
		card: "summary_large_image",
		title: "AI Model Comparison Tool",
		description:
			"Compare LLM pricing, context, and features across providers in a side-by-side view.",
	},
};

const webApplicationSchema = {
	"@context": "https://schema.org",
	"@type": "WebApplication",
	name: "AI Model Comparison Tool",
	url: "https://llmgateway.io/models/compare",
	applicationCategory: "DeveloperApplication",
	operatingSystem: "Web",
	offers: {
		"@type": "Offer",
		price: "0",
		priceCurrency: "USD",
	},
	description:
		"Interactive tool to compare any two AI models side by side — per-token pricing, context window, and capabilities across providers.",
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
		{
			"@type": "ListItem",
			position: 3,
			name: "Compare",
			item: "https://llmgateway.io/models/compare",
		},
	],
};

export default function ModelsComparePage() {
	return (
		<>
			<JsonLd data={[webApplicationSchema, breadcrumbSchema]} />
			<Navbar />
			<main className="min-h-screen bg-background pt-24 md:pt-32 pb-16">
				<div className="container mx-auto px-4">
					<header className="mb-8">
						<h1 className="text-3xl md:text-4xl font-bold tracking-tight">
							Compare AI Models Side by Side
						</h1>
						<p className="mt-2 text-muted-foreground max-w-2xl">
							Select any two models to compare pricing, context window, and key
							capabilities across providers.
						</p>
					</header>
					<section aria-labelledby="comparison-tool-heading">
						<h2 id="comparison-tool-heading" className="sr-only">
							Model comparison tool
						</h2>
						<Suspense>
							<ModelComparison />
						</Suspense>
					</section>
				</div>
			</main>
			<Footer />
		</>
	);
}
