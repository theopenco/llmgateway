import { buildRssResponse } from "@/lib/rss";

export async function GET() {
	const { allBlogs } = await import("content-collections");
	return buildRssResponse({
		title: "LLM Gateway Blog",
		description:
			"News, tutorials, and deep-dives from the LLM Gateway team on AI gateways, model routing, and LLM costs.",
		siteUrl: "https://llmgateway.io/blog",
		feedUrl: "https://llmgateway.io/blog/rss.xml",
		items: allBlogs
			.filter((entry) => !entry.draft)
			.map((entry) => ({
				title: entry.title,
				url: `https://llmgateway.io/blog/${entry.slug}`,
				description: entry.summary,
				date: entry.date,
			})),
	});
}
