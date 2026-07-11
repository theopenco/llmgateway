import { docsBaseUrl } from "@/lib/base-url";

import type { MetadataRoute } from "next";

// Metadata routes don't inherit the root layout's force-dynamic; without it
// this route is prerendered at build time with the build-time DOCS_URL
// (usually the fallback) baked in instead of the runtime value.
export const dynamic = "force-dynamic";

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
