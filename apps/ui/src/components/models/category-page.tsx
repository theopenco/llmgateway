import { Suspense } from "react";

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

import type { Metadata } from "next";

export function buildCategoryMetadata(slug: ModelCategorySlug): Metadata {
	const content = modelCategoryContent[slug];
	return {
		alternates: {
			canonical: `https://llmgateway.io/models/${slug}`,
		},
		title: content.metaTitle,
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
	const url = `https://llmgateway.io/models/${slug}`;

	const collectionSchema = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		name: content.metaTitle,
		description: content.metaDescription,
		url,
		mainEntity: {
			"@type": "ItemList",
			numberOfItems: categoryModels.length,
			itemListElement: categoryModels.map((model, index) => ({
				"@type": "ListItem",
				position: index + 1,
				url: `https://llmgateway.io/models/${encodeURIComponent(model.id)}`,
				name: model.name ?? model.id,
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
					models={models}
					providers={providers}
					title={content.heading}
					description={content.subheading}
					categoryFilter={slug}
					seoContent={
						<CategorySeoContent intro={content.intro} faqs={content.faqs} />
					}
				>
					<HeroRSC navbarOnly sticky={false} />
				</AllModels>
			</Suspense>
		</>
	);
}
