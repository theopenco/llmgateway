import { ogContentType, ogImage, ogSize } from "@/lib/og";
import { listedProviders } from "@/lib/providers-catalog";

import { getProviderCountries } from "@llmgateway/models";

export const size = ogSize;
export const contentType = ogContentType;

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
	const providerCount = match
		? listedProviders.filter((p) => p.headquarters === match.code).length
		: 0;
	return ogImage({
		eyebrow: "Providers",
		title: match ? `AI Providers in ${match.name}` : "AI Providers",
		subtitle: match
			? `${providerCount} AI ${providerCount === 1 ? "provider" : "providers"} headquartered in ${match.name}, available through one OpenAI-compatible API.`
			: "Browse AI providers by headquarters country on LLM Gateway.",
	});
}
