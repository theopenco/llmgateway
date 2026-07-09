import { BlogList } from "@/components/blog/list";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { JsonLd } from "@/components/seo/json-ld";

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
		.sort(
			(a: any, b: any) =>
				new Date(b.date).getTime() - new Date(a.date).getTime(),
		)
		.filter((entry: any) => !entry?.draft)
		.map(({ ...entry }: any) => entry as BlogItem);

	const collectionSchema = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		name: "LLM Gateway Blog",
		description: "News, tutorials, and deep-dives from the LLM Gateway team.",
		url: "https://llmgateway.io/blog",
		mainEntity: {
			"@type": "ItemList",
			numberOfItems: sortedEntries.length,
			itemListElement: sortedEntries.map((entry, index) => ({
				"@type": "ListItem",
				position: index + 1,
				url: `https://llmgateway.io/blog/${entry.slug}`,
				name: entry.title,
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
				name: "Blog",
				item: "https://llmgateway.io/blog",
			},
		],
	};

	return (
		<div>
			<JsonLd data={[collectionSchema, breadcrumbSchema]} />
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
			"News, tutorials, and deep-dives from the LLM Gateway team on AI gateways, routing, costs, and building with LLMs.",
		alternates: { canonical: "/blog" },
		openGraph: {
			title: "Blog — News, Tutorials, and Deep-Dives",
			description:
				"News, tutorials, and deep-dives from the LLM Gateway team on AI gateways, routing, costs, and building with LLMs.",
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
