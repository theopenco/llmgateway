import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: ["/dashboard", "/api/"],
			},
		],
		sitemap: "https://devpass.llmgateway.io/sitemap.xml",
	};
}
