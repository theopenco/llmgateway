import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: [
					"/dashboard",
					"/dashboard/",
					"/api",
					"/api/",
					"/onboarding",
					"/login",
					"/signup",
					"/forgot-password",
					"/reset-password",
				],
			},
		],
		sitemap: "https://llmgateway.io/sitemap.xml",
	};
}
