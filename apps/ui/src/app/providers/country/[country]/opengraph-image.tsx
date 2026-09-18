import { getOgProviderIcon } from "@/lib/og-icons";
import {
	providerOgCard,
	providerOgContentType,
	providerOgSize,
} from "@/lib/provider-og";
import {
	countModelsForProviders,
	listedProviders,
} from "@/lib/providers-catalog";

import { getProviderCountries } from "@llmgateway/models";

export const size = providerOgSize;
export const contentType = providerOgContentType;

// Satori cannot run at request time in production; prerender every country.
export const dynamicParams = false;

export function generateStaticParams() {
	return getProviderCountries().map((country) => ({
		country: country.code.toLowerCase(),
	}));
}

export default async function ProviderCountryOgImage({
	params,
}: {
	params: Promise<{ country: string }>;
}) {
	const { country } = await params;
	const match = getProviderCountries().find(
		(c) => c.code.toLowerCase() === country.toLowerCase(),
	);
	const countryProviders = match
		? listedProviders.filter((p) => p.headquarters === match.code)
		: [];
	const modelCount = countModelsForProviders(
		new Set(countryProviders.map((provider) => provider.id)),
	);

	return providerOgCard({
		eyebrow: match ? `Providers · ${match.code}` : "Provider directory",
		title: match ? `AI providers in ${match.name}` : "AI providers by country",
		subtitle: match
			? `Route to providers headquartered in ${match.name} — or pin your traffic to them with a data-residency policy.`
			: "Browse AI providers by headquarters country on LLM Gateway.",
		logos: countryProviders.map((provider) => ({
			id: provider.id,
			Icon: getOgProviderIcon(provider.id),
		})),
		stats: [
			{ label: "Providers", value: String(countryProviders.length) },
			{ label: "Models", value: String(modelCount) },
			{ label: "Endpoints", value: "1" },
		],
	});
}
