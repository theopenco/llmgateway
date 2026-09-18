import { getOgProviderIcon } from "@/lib/og-icons";
import {
	defaultProviderAccent,
	providerOgCard,
	providerOgContentType,
	providerOgSize,
} from "@/lib/provider-og";
import { activeModelCounts } from "@/lib/providers-catalog";

import {
	getProviderCountries,
	providers as providerDefinitions,
} from "@llmgateway/models";
import { ogIconSize } from "@llmgateway/shared/components";

export const size = providerOgSize;
export const contentType = providerOgContentType;

// Prerendered at build time: rendering these cards on demand runs satori inside
// the request, which the production pods do not have the headroom for and which
// took the whole route down with a 503. dynamicParams keeps unknown ids from
// reaching the renderer at runtime at all.
export const dynamicParams = false;

export function generateStaticParams() {
	return providerDefinitions
		.filter((provider) => provider.name !== "LLM Gateway")
		.map((provider) => ({ id: provider.id }));
}

interface ImageProps {
	params: Promise<{ id: string }>;
}

const countryNames = new Map(
	getProviderCountries().map((country) => [country.code, country.name]),
);

/** First sentence of the catalogue blurb, short enough to stay on two lines. */
function toTagline(description: string) {
	const sentence = description.split(/(?<=\.)\s/)[0] ?? description;
	const trimmed = sentence.replace(/\s+/g, " ").trim();
	if (trimmed.length <= 118) {
		return trimmed;
	}
	return `${trimmed.slice(0, 117).trimEnd()}…`;
}

export default async function ProviderOgImage({ params }: ImageProps) {
	const { id } = await params;
	const decodedId = decodeURIComponent(id);
	const provider = providerDefinitions.find((p) => p.id === decodedId);

	if (!provider || provider.name === "LLM Gateway") {
		return providerOgCard({
			eyebrow: "Provider directory",
			title: "Provider not found",
			subtitle: "Browse every provider routed by LLM Gateway.",
			stats: [{ label: "Directory", value: "llmgateway.io/providers" }],
		});
	}

	const Icon = getOgProviderIcon(provider.id);
	const modelCount = activeModelCounts[provider.id] ?? 0;
	const headquarters = provider.headquarters
		? (countryNames.get(provider.headquarters) ?? provider.headquarters)
		: "—";
	const dataPolicy = provider.dataPolicy;
	const chips = [
		provider.streaming ? "Streaming" : null,
		provider.cancellation ? "Cancellation" : null,
		dataPolicy?.soc2 ? `SOC 2 Type ${dataPolicy.soc2}` : null,
		dataPolicy?.iso27001 ? "ISO 27001" : null,
		dataPolicy?.gdpr ? "GDPR" : null,
	].filter((chip): chip is string => chip !== null);
	const trainingStat =
		dataPolicy?.apiTraining === undefined || dataPolicy?.apiTraining === null
			? { label: "Streaming", value: provider.streaming ? "Yes" : "No" }
			: {
					label: "Trains on API data",
					value: dataPolicy.apiTraining ? "Yes" : "No",
				};

	return providerOgCard({
		eyebrow: "Provider",
		title: provider.name,
		subtitle: toTagline(provider.description),
		accent: provider.color ?? defaultProviderAccent,
		mark: <Icon {...ogIconSize(Icon, 68)} />,
		chips,
		stats: [
			{
				label: modelCount === 1 ? "Model" : "Models",
				value: String(modelCount),
			},
			{ label: "Headquarters", value: headquarters },
			trainingStat,
		],
	});
}
