import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: ["/dashboard/", "/api/", "/login", "/signup", "/onboarding"],
			},
		],
		sitemap: "https://llmgateway.io/sitemap.xml",
	};
}
