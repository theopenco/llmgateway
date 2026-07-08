import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	const docsBaseUrl = process.env.DOCS_URL ?? "https://docs.llmgateway.io";

	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: ["/api/", "/llms.mdx/", "/docs-og/"],
			},
		],
		sitemap: `${docsBaseUrl}/sitemap.xml`,
	};
}
