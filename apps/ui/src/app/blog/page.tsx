import { BlogList } from "@/components/blog/list";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { JsonLd } from "@/components/seo/json-ld";

import type { Blog } from "content-collections";

interface BlogItem {
	id: string;
	slug: string;
	date: string;
	title: string;
	summary: string;
}

export default async function BlogPage() {
	const { allBlogs } = await import("content-collections");

	const sortedEntries = allBlogs
		.filter((entry: Blog) => !entry?.draft)
		.sort(
			(a: Blog, b: Blog) =>
				new Date(b.date).getTime() - new Date(a.date).getTime(),
		)
		.map(({ ...entry }: Blog) => entry as BlogItem);

	// Standalone top-level ItemList (referenced by the CollectionPage via @id)
	// so parsers that only inspect top-level @type values still see the list.
	const itemListSchema = {
		"@context": "https://schema.org",
		"@type": "ItemList",
		"@id": "https://llmgateway.io/blog#post-list",
		name: "LLM Gateway Blog",
		numberOfItems: sortedEntries.length,
		itemListElement: sortedEntries.map((entry, index) => ({
			"@type": "ListItem",
			position: index + 1,
			url: `https://llmgateway.io/blog/${entry.slug}`,
			name: entry.title,
		})),
	};

	const collectionSchema = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		name: "LLM Gateway Blog",
		description: "News, tutorials, and deep-dives from the LLM Gateway team.",
		url: "https://llmgateway.io/blog",
		mainEntity: { "@id": "https://llmgateway.io/blog#post-list" },
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
				name: "Blog",
				item: "https://llmgateway.io/blog",
			},
		],
	};

	return (
		<div>
			<JsonLd data={[collectionSchema, itemListSchema, breadcrumbSchema]} />
			<HeroRSC navbarOnly />
			<BlogList
				entries={sortedEntries}
				heading="Blog"
				subheading="Latest news and updates from LLM Gateway"
			/>
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "Blog — News, Tutorials, and Deep-Dives",
		description:
			"News, tutorials, and deep-dives from the LLM Gateway team on AI gateways, model routing, LLM costs, model comparisons, and shipping production AI apps.",
		alternates: { canonical: "/blog" },
		openGraph: {
			title: "Blog — News, Tutorials, and Deep-Dives",
			description:
				"News, tutorials, and deep-dives from the LLM Gateway team on AI gateways, model routing, LLM costs, model comparisons, and shipping production AI apps.",
			type: "website",
			url: "https://llmgateway.io/blog",
		},
		twitter: {
			card: "summary_large_image",
			title: "Blog — News, Tutorials, and Deep-Dives",
			description:
				"News, tutorials, and deep-dives from the LLM Gateway team on AI gateways, routing, and building with LLMs.",
		},
	};
}
