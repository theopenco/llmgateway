import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: ["/login", "/signup", "/api/"],
			},
		],
		sitemap: "https://chat.llmgateway.io/sitemap.xml",
	};
}
