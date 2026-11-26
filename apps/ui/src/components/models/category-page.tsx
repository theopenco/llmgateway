import { Suspense } from "react";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { CategorySeoContent } from "@/components/models/category-seo-content";
import { JsonLd } from "@/components/seo/json-ld";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";
import {
	modelCategoryContent,
	type ModelCategorySlug,
} from "@/lib/model-category-content";
import { applyCategoryFilter } from "@/lib/model-category-filters";
import { pageTitle } from "@/lib/page-title";
import { fetchServerData } from "@/lib/server-api";

import type { CategoryRankingEntry } from "@/components/models/category-seo-content";
import type { paths } from "@/lib/api/v1";
import type { Metadata } from "next";

type ModelStats =
	paths["/public/models/stats"]["get"]["responses"][200]["content"]["application/json"];

const RANKING_WINDOW = "30d";
const RANKING_SIZE = 10;

export function buildCategoryMetadata(slug: ModelCategorySlug): Metadata {
	const content = modelCategoryContent[slug];
	return {
		alternates: {
			canonical: `https://llmgateway.io/models/${slug}`,
		},
		title: pageTitle(content.metaTitle),
		description: content.metaDescription,
		openGraph: {
			title: content.metaTitle,
			description: content.metaDescription,
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: content.metaTitle,
			description: content.metaDescription,
		},
	};
}

export async function ModelCategoryPage({ slug }: { slug: ModelCategorySlug }) {
	const content = modelCategoryContent[slug];
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	const categoryModels = models.filter((model) =>
		applyCategoryFilter(slug, model, model.mappings),
	);
	const stats = await fetchServerData<ModelStats>(
		"GET",
		"/public/models/stats",
		{ params: { query: { window: RANKING_WINDOW } } },
	);
	const tokensByModel = new Map(
		(stats?.models ?? []).map((model) => [model.modelId, model.totalTokens]),
	);
	const ranking: CategoryRankingEntry[] = categoryModels
		.map((model) => ({
			id: model.id,
			name: model.name ?? model.id,
			totalTokens: tokensByModel.get(model.id) ?? 0,
		}))
		.filter((model) => model.totalTokens > 0)
		.sort((a, b) => b.totalTokens - a.totalTokens)
		.slice(0, RANKING_SIZE);
	const rankedIds = new Set(ranking.map((model) => model.id));
	const listedModels = [
		...ranking,
		...categoryModels
			.filter((model) => !rankedIds.has(model.id))
			.map((model) => ({ id: model.id, name: model.name ?? model.id })),
	];
	const url = `https://llmgateway.io/models/${slug}`;

	const collectionSchema = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		name: content.metaTitle,
		description: content.metaDescription,
		url,
		mainEntity: {
			"@type": "ItemList",
			numberOfItems: listedModels.length,
			itemListElement: listedModels.map((model, index) => ({
				"@type": "ListItem",
				position: index + 1,
				url: `https://llmgateway.io/models/${encodeURIComponent(model.id)}`,
				name: model.name,
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
				name: "Models",
				item: "https://llmgateway.io/models",
			},
			{
				"@type": "ListItem",
				position: 3,
				name: content.heading,
				item: url,
			},
		],
	};

	const faqSchema = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: content.faqs.map((faq) => ({
			"@type": "Question",
			name: faq.question,
			acceptedAnswer: {
				"@type": "Answer",
				text: faq.answer,
			},
		})),
	};

	return (
		<>
			<JsonLd data={[collectionSchema, breadcrumbSchema, faqSchema]} />
			<Suspense>
				<AllModels
					footer={<Footer />}
					models={models}
					providers={providers}
					title={content.heading}
					description={content.subheading}
					categoryFilter={slug}
					seoContent={
						<CategorySeoContent
							heading={content.heading}
							intro={content.intro}
							faqs={content.faqs}
							ranking={ranking}
						/>
					}
				>
					<HeroRSC sticky={false} />
				</AllModels>
			</Suspense>
		</>
	);
}
