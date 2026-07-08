import { docsBaseUrl } from "@/lib/base-url";

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				// /docs-og/ must stay crawlable: it serves the og:image /
				// twitter:image for every docs page, and preview bots respect
				// robots.txt. /llms.mdx markdown mirrors are noindexed via
				// X-Robots-Tag on the route instead of blocked here, so AI
				// crawlers can still fetch them.
				disallow: ["/api/"],
			},
		],
		sitemap: `${docsBaseUrl}/sitemap.xml`,
	};
}
