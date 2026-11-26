import { buildRssResponse } from "@/lib/rss";

export async function GET() {
	const { allChangelogs } = await import("content-collections");
	return buildRssResponse({
		title: "LLM Gateway Changelog",
		description:
			"New features, models, and improvements shipped in LLM Gateway.",
		siteUrl: "https://llmgateway.io/changelog",
		feedUrl: "https://llmgateway.io/changelog/rss.xml",
		items: allChangelogs
			.filter((entry) => !entry.draft)
			.map((entry) => ({
				title: entry.title,
				url: `https://llmgateway.io/changelog/${entry.slug}`,
				description: entry.summary,
				date: entry.date,
			})),
	});
}
