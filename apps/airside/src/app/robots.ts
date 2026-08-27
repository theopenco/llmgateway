import type { MetadataRoute } from "next";

// Console routes only. Auth pages (/login, /signup, /onboarding) are
// intentionally NOT disallowed: they serve noindex meta, and a crawler must be
// able to fetch a page to see it — a robots.txt disallow instead strands
// already-indexed URLs as "Indexed, though blocked by robots.txt".
const disallow = ["/dashboard", "/dashboard/", "/api", "/api/"];

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{ userAgent: "*", allow: "/", disallow },
			// Named explicitly so a future blanket change cannot silently cut off
			// the crawlers that cite us in AI answers.
			{
				userAgent: [
					"GPTBot",
					"ChatGPT-User",
					"OAI-SearchBot",
					"ClaudeBot",
					"Claude-User",
					"PerplexityBot",
					"Google-Extended",
				],
				allow: "/",
				disallow,
			},
		],
		sitemap: "https://airside.llmgateway.io/sitemap.xml",
	};
}
