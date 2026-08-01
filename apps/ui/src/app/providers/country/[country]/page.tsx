import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { ProvidersGrid } from "@/components/providers/providers-grid";
import { JsonLd } from "@/components/seo/json-ld";

import {
	getProviderCountries,
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@llmgateway/models";

import type { Metadata } from "next";

interface CountryPageProps {
	params: Promise<{ country: string }>;
}

function findCountry(code: string) {
	return getProviderCountries().find(
		(country) => country.code.toLowerCase() === code.toLowerCase(),
	);
}

function providersForCountry(code: string) {
	return providerDefinitions.filter(
		(provider) =>
			provider.name !== "LLM Gateway" &&
			provider.id !== "custom" &&
			provider.headquarters === code,
	);
}

function modelCountForProviders(providerIds: Set<string>): number {
	return modelDefinitions.filter((model) =>
		model.providers.some((p) => providerIds.has(p.providerId)),
	).length;
}

export default async function ProviderCountryPage({
	params,
}: CountryPageProps) {
	const { country: countryParam } = await params;
	const country = findCountry(countryParam);

	if (!country) {
		notFound();
	}

	const countryProviders = providersForCountry(country.code);
	const modelCount = modelCountForProviders(
		new Set(countryProviders.map((p) => p.id)),
	);

	const countryUrl = `https://llmgateway.io/providers/country/${country.code.toLowerCase()}`;

	const collectionSchema = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		name: `LLM providers headquartered in ${country.name}`,
		description: `Browse the ${countryProviders.length} AI providers headquartered in ${country.name} available through LLM Gateway's unified, OpenAI-compatible API.`,
		url: countryUrl,
		mainEntity: {
			"@type": "ItemList",
			numberOfItems: countryProviders.length,
			itemListElement: countryProviders.map((provider, index) => ({
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
			{
				"@type": "ListItem",
				position: 3,
				name: country.name,
				item: countryUrl,
			},
		],
	};

	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<JsonLd data={[collectionSchema, breadcrumbSchema]} />
			<main>
				<HeroRSC navbarOnly />
				<ProvidersGrid
					countryCode={country.code}
					heading={`${country.flag} AI Providers in ${country.name}`}
					subheading={`Access ${modelCount} models from ${countryProviders.length} AI ${
						countryProviders.length === 1 ? "provider" : "providers"
					} headquartered in ${country.name} through our unified API`}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateStaticParams() {
	return getProviderCountries().map((country) => ({
		country: country.code.toLowerCase(),
	}));
}

export async function generateMetadata({
	params,
}: CountryPageProps): Promise<Metadata> {
	const { country: countryParam } = await params;
	const country = findCountry(countryParam);

	if (!country) {
		return {};
	}

	const countryProviders = providersForCountry(country.code);
	const description = `Browse ${countryProviders.length} AI providers headquartered in ${country.name} — access their models through LLM Gateway's OpenAI-compatible API with automatic fallback, caching, and cost analytics.`;
	const canonical = `/providers/country/${country.code.toLowerCase()}`;

	return {
		title: `AI Providers in ${country.name}`,
		description,
		alternates: { canonical },
		openGraph: {
			title: `AI Providers in ${country.name} | LLM Gateway`,
			description,
			type: "website",
			url: `https://llmgateway.io${canonical}`,
		},
		twitter: {
			card: "summary_large_image",
			title: `AI Providers in ${country.name} | LLM Gateway`,
			description,
		},
	};
}
