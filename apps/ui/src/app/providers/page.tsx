import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { ProvidersGrid } from "@/components/providers/providers-grid";
import { JsonLd } from "@/components/seo/json-ld";

import { providers as providerDefinitions } from "@llmgateway/models";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "LLM Providers",
	description:
		"Browse 40+ LLM providers on LLM Gateway — OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek, xAI, and more. One API for all of them.",
	alternates: { canonical: "/providers" },
	openGraph: {
		title: "LLM Providers | LLM Gateway",
		description:
			"Browse 40+ LLM providers on LLM Gateway — OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek, xAI, and more.",
		url: "https://llmgateway.io/providers",
		type: "website",
	},
};

const listedProviders = providerDefinitions.filter(
	(provider) => provider.name !== "LLM Gateway",
);

const collectionSchema = {
	"@context": "https://schema.org",
	"@type": "CollectionPage",
	name: "LLM Providers",
	description:
		"Browse the LLM providers available through LLM Gateway — OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek, xAI, and more. One API for all of them.",
	url: "https://llmgateway.io/providers",
	mainEntity: {
		"@type": "ItemList",
		numberOfItems: listedProviders.length,
		itemListElement: listedProviders.map((provider, index) => ({
			"@type": "ListItem",
			position: index + 1,
			url: `https://llmgateway.io/providers/${provider.id}`,
			name: provider.name,
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
			name: "Providers",
			item: "https://llmgateway.io/providers",
		},
	],
};

export default function ProvidersPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<JsonLd data={[collectionSchema, breadcrumbSchema]} />
			<main>
				<HeroRSC navbarOnly />
				<ProvidersGrid />
			</main>
			<Footer />
		</div>
	);
}
