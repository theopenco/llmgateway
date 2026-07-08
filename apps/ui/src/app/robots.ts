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
					"/sso",
					"/forgot-password",
					"/reset-password",
					"/connect",
					"/connect/",
					"/ref",
					"/ref/",
				],
			},
		],
		sitemap: "https://llmgateway.io/sitemap.xml",
	};
}
