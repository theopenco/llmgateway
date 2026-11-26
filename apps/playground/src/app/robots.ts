import { AI_CRAWLER_USER_AGENTS } from "@llmgateway/shared/ai-crawlers";

import type { MetadataRoute } from "next";

const disallow = ["/api/"];

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow,
			},
			{ userAgent: AI_CRAWLER_USER_AGENTS, allow: "/", disallow },
		],
		sitemap: "https://lounge.llmgateway.io/sitemap.xml",
	};
}
