import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { ProvidersGrid } from "@/components/providers/providers-grid";
import { JsonLd } from "@/components/seo/json-ld";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";
import { listedProviders } from "@/lib/providers-catalog";

import { providers as providerDefinitions } from "@llmgateway/models";

import type { ExtraGridProvider } from "@/components/providers/providers-grid";
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

export default async function ProvidersPage() {
	// Carrier-uploaded branding (Airside claims) overlays the built-in marks.
	const [apiProviders, apiModels] = await Promise.all([
		fetchProviders().catch(() => []),
		fetchModels().catch(() => []),
	]);
	const uploadedLogos = Object.fromEntries(
		apiProviders
			.filter((p) => p.airsideLogoUrl)
			.map((p) => [p.id, p.airsideLogoUrl as string]),
	);

	// DB-only providers (custom Airside carriers) join the static grid; every
	// static catalogue id — listed or not — stays owned by the static config.
	const staticIds = new Set(providerDefinitions.map((p) => p.id as string));
	const extraProviders: ExtraGridProvider[] = apiProviders
		.filter((p) => !staticIds.has(p.id))
		.map((p) => ({
			id: p.id,
			name: p.name ?? p.id,
			description:
				p.description && p.description !== "(empty)" ? p.description : null,
			modelsCount: apiModels.filter((model) =>
				model.mappings.some(
					(mapping) =>
						mapping.providerId === p.id && mapping.status === "active",
				),
			).length,
		}))
		.filter((p) => p.modelsCount > 0);

	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<JsonLd data={[collectionSchema, breadcrumbSchema]} />
			<main>
				<HeroRSC navbarOnly />
				<ProvidersGrid
					uploadedLogos={uploadedLogos}
					extraProviders={extraProviders}
				/>
			</main>
			<Footer />
		</div>
	);
}
