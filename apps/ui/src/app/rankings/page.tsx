import dynamic from "next/dynamic";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import { fetchServerData } from "@/lib/server-api";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";

import type {
	RankingsAppStat,
	RankingsModelMeta,
} from "@/components/rankings/rankings-content";
import type { Metadata } from "next";

// The rankings list pulls in recharts; load it lazily so the chart library
// stays out of the route's initial bundle.
const RankingsContent = dynamic(() =>
	import("@/components/rankings/rankings-content").then(
		(mod) => mod.RankingsContent,
	),
);

export const revalidate = 300;

const title = "LLM Rankings — Top Models by Real Usage";
const description =
	"Live LLM rankings from real traffic routed through LLM Gateway: top models and apps by token volume, usage trends, and provider market share.";

export const metadata: Metadata = {
	title,
	description,
	alternates: { canonical: "https://llmgateway.io/rankings" },
	openGraph: {
		title,
		description,
		type: "website",
		url: "https://llmgateway.io/rankings",
	},
	twitter: {
		card: "summary_large_image",
		title,
		description,
	},
};

interface PublicModelStats {
	models: Array<{ modelId: string; totalTokens: number }>;
}

interface PublicApps {
	apps: RankingsAppStat[];
}

export default async function RankingsPage() {
	const knownProviderIds = new Set<string>(
		providerDefinitions.map((p) => p.id),
	);
	const providerNames: Record<string, string> = {};
	for (const provider of providerDefinitions) {
		providerNames[provider.id] = provider.name;
	}

	// The client component receives a lean lookup instead of importing the full
	// catalogue into the browser bundle.
	const modelMeta: Record<string, RankingsModelMeta> = {};
	for (const model of modelDefinitions as readonly ModelDefinition[]) {
		const firstProviderId = model.providers[0]?.providerId ?? "";
		modelMeta[model.id] = {
			name: model.name ?? model.id,
			family: model.family,
			// Icon identity: the model's creator when we have a logo for it,
			// otherwise the first provider serving it.
			providerId: knownProviderIds.has(model.family)
				? model.family
				: firstProviderId,
		};
	}

	// The model snapshot feeds structured data while the app snapshot renders in
	// the rankings sidebar. Interactive model stats are fetched client-side.
	const [stats, apps] = await Promise.all([
		fetchServerData<PublicModelStats>("GET", "/public/models/stats", {
			params: { query: { window: "7d" } },
		}),
		fetchServerData<PublicApps>("GET", "/public/apps", {
			params: { query: { limit: "5" } },
		}),
	]);
	const topModels = (stats?.models ?? []).slice(0, 10);
	const topApps = apps?.apps ?? [];

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
				name: "Rankings",
				item: "https://llmgateway.io/rankings",
			},
		],
	};

	const itemListSchema =
		topModels.length > 0
			? {
					"@context": "https://schema.org",
					"@type": "ItemList",
					name: "Top LLMs by usage on LLM Gateway",
					description,
					itemListOrder: "https://schema.org/ItemListOrderDescending",
					numberOfItems: topModels.length,
					itemListElement: topModels.map((model, index) => ({
						"@type": "ListItem",
						position: index + 1,
						name: modelMeta[model.modelId]?.name ?? model.modelId,
						url: `https://llmgateway.io/models/${encodeURIComponent(model.modelId)}`,
					})),
				}
			: null;

	return (
		<>
			<JsonLd
				data={
					itemListSchema
						? [breadcrumbSchema, itemListSchema]
						: [breadcrumbSchema]
				}
			/>
			<Navbar />
			<div className="min-h-screen bg-background pt-24 md:pt-32 pb-16">
				<div className="container mx-auto px-4 py-8">
					<div className="mb-10 max-w-2xl">
						<p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Live from the gateway
						</p>
						<h1 className="text-3xl font-bold tracking-tight md:text-5xl">
							LLM Rankings
						</h1>
						<p className="mt-4 text-muted-foreground md:text-lg">
							Which models and apps developers actually use in production.
							Ranked by real token volume routed through LLM Gateway — not
							benchmarks, not vibes.
						</p>
					</div>
					<RankingsContent
						modelMeta={modelMeta}
						providerNames={providerNames}
						topApps={topApps}
					/>
				</div>
			</div>
			<Footer />
		</>
	);
}
