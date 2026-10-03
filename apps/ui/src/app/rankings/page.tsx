import dynamic from "next/dynamic";

import { CompareFaq } from "@/components/compare/compare-faq";
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
	// Routing pseudo-models (auto, custom) are not models a reader can pick.
	const leaders = topModels
		.filter((model) => modelMeta[model.modelId]?.family !== "llmgateway")
		.slice(0, 3)
		.map((model) => modelMeta[model.modelId]?.name ?? model.modelId);

	const faqs = [
		...(leaders.length
			? [
					{
						question: "What are the most used LLMs right now?",
						answer: `By token volume over the last 7 days, the most used models on LLM Gateway are ${leaders.join(", ")}. The table above updates from live traffic, so switch to 24 hours for what is trending today.`,
					},
				]
			: []),
		{
			question: "How are the LLM rankings calculated?",
			answer:
				"Models are ranked by the total tokens routed through LLM Gateway in the selected window. Every request counts, whichever provider served it, so the ranking reflects what developers run in production rather than benchmark scores.",
		},
		{
			question: "Which time windows can I compare?",
			answer:
				"Rankings cover the last 24 hours, 7 days and 30 days. The change column compares each model's token volume with the previous window of the same length.",
		},
		{
			question: "Are these rankings the same as benchmark leaderboards?",
			answer:
				"No. Benchmarks measure quality on fixed tests; these rankings measure adoption. Use both: model pages show benchmark results, where available, next to pricing and providers.",
		},
		{
			question: "Can I use the top-ranked models through one API?",
			answer:
				"Yes. Every ranked model is available through LLM Gateway's OpenAI-compatible API at https://api.llmgateway.io/v1 with a single API key.",
		},
	];

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
					<section
						aria-labelledby="rankings-method-heading"
						className="mt-16 max-w-3xl"
					>
						<h2
							id="rankings-method-heading"
							className="text-2xl font-bold tracking-tight md:text-3xl"
						>
							How the LLM rankings work
						</h2>
						<p className="mt-4 text-muted-foreground">
							Each model is ranked by the tokens it processed through LLM
							Gateway in the selected window, across every provider that serves
							it. Token volume shows where real workloads run: a model can top a
							benchmark and still see little production use.
						</p>
						<h3 className="mt-8 text-lg font-semibold">What is counted</h3>
						<p className="mt-2 text-muted-foreground">
							Tokens from requests routed through the gateway, grouped by model.
							The apps list ranks the tools that identify themselves by the
							tokens they send.
						</p>
						<h3 className="mt-6 text-lg font-semibold">
							How to read the change column
						</h3>
						<p className="mt-2 text-muted-foreground">
							The change compares a model's token volume with the previous
							window of the same length, so a new release climbing fast stands
							out even before it reaches the top.
						</p>
					</section>
				</div>
				<CompareFaq heading="LLM rankings, answered" faqs={faqs} />
			</div>
			<Footer />
		</>
	);
}
