import { TimelineClient } from "@/components/timeline/timeline-client";
import { fetchModels } from "@/lib/fetch-models";
import {
	buildTimelineFaqs,
	buildTimelineModels,
	buildTimelineStats,
} from "@/lib/timeline-data";

import type { Metadata } from "next";

const BASE_URL = "https://llmgateway.io";

export const metadata: Metadata = {
	title: "LLM Release Timeline — When Each AI Model Was Released",
	description:
		"Release dates for every major LLM. See when GPT, Claude, Gemini, Llama, Mistral and DeepSeek models shipped from their provider and when each was added to LLM Gateway.",
	alternates: {
		canonical: "/timeline",
	},
	openGraph: {
		title: "LLM Release Timeline — When Each AI Model Was Released",
		description:
			"Release dates for every major LLM — GPT, Claude, Gemini, Llama, Mistral and DeepSeek — with the date each model was added to LLM Gateway.",
		type: "website",
		url: `${BASE_URL}/timeline`,
	},
	twitter: {
		card: "summary_large_image",
		title: "LLM Release Timeline — When Each AI Model Was Released",
		description:
			"Release dates for every major LLM — GPT, Claude, Gemini, Llama, Mistral and DeepSeek — and when each was added to LLM Gateway.",
	},
};

export default async function TimelinePage() {
	const models = await fetchModels();

	const timelineModels = buildTimelineModels(models);
	const stats = buildTimelineStats(timelineModels, models);
	const faqs = buildTimelineFaqs(timelineModels, stats);

	const datasetSchema = {
		"@context": "https://schema.org",
		"@type": "Dataset",
		name: "LLM Model Release Timeline",
		description:
			"A continuously updated dataset of large language model releases: the provider release date and the date each model was added to LLM Gateway.",
		url: `${BASE_URL}/timeline`,
		keywords: [
			"LLM release dates",
			"AI model timeline",
			"GPT release date",
			"Claude release date",
			"Gemini release date",
			"language model history",
		],
		creator: {
			"@type": "Organization",
			name: "LLM Gateway",
			url: BASE_URL,
		},
		isAccessibleForFree: true,
		...(stats.firstYear
			? {
					temporalCoverage: `${stats.firstYear}-01-01/${
						stats.latestReleasedAt?.slice(0, 10) ?? ".."
					}`,
				}
			: {}),
		...(stats.latestReleasedAt
			? { dateModified: stats.latestReleasedAt.slice(0, 10) }
			: {}),
		variableMeasured: ["Provider release date", "Date added to LLM Gateway"],
	};

	const itemListSchema = {
		"@context": "https://schema.org",
		"@type": "ItemList",
		name: "LLM models by release date",
		numberOfItems: timelineModels.length,
		itemListElement: timelineModels.map((model, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: `${model.name} (${model.providerName})`,
			url: `${BASE_URL}/models/${encodeURIComponent(model.id)}`,
		})),
	};

	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{
				"@type": "ListItem",
				position: 1,
				name: "Home",
				item: BASE_URL,
			},
			{
				"@type": "ListItem",
				position: 2,
				name: "Model Timeline",
				item: `${BASE_URL}/timeline`,
			},
		],
	};

	const faqSchema = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: faqs.map((faq) => ({
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
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
			/>
			<TimelineClient models={timelineModels} stats={stats} faqs={faqs} />
		</>
	);
}
