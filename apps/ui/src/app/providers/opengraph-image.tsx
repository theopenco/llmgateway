import { getOgProviderIcon } from "@/lib/og-icons";
import {
	providerOgCard,
	providerOgContentType,
	providerOgSize,
} from "@/lib/provider-og";
import {
	activeModelCounts,
	listedModelCount,
	listedProviders,
} from "@/lib/providers-catalog";

export const size = providerOgSize;
export const contentType = providerOgContentType;
export const alt = "LLM Gateway — Every LLM provider behind one API";

export default function Image() {
	const logos = [...listedProviders]
		.sort(
			(a, b) =>
				(activeModelCounts[b.id] ?? 0) - (activeModelCounts[a.id] ?? 0) ||
				a.name.localeCompare(b.name),
		)
		.map((provider) => ({
			id: provider.id,
			Icon: getOgProviderIcon(provider.id),
		}));

	return providerOgCard({
		eyebrow: "Provider directory",
		title: "Every provider, one API",
		subtitle:
			"Route to any of them with the same OpenAI-compatible request — no new SDK, no new keys.",
		logos,
		stats: [
			{ label: "Providers", value: String(listedProviders.length) },
			{ label: "Models", value: String(listedModelCount) },
			{ label: "Endpoints", value: "1" },
		],
	});
}
