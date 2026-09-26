import { RESOURCE_PAGES } from "@/lib/resources";

import type { MetadataRoute } from "next";

const baseUrl = "https://airside.llmgateway.io";

export default function sitemap(): MetadataRoute.Sitemap {
	return [
		...["/resources", ...RESOURCE_PAGES.map((page) => page.href)].map(
			(path) => ({
				url: `${baseUrl}${path}`,
				changeFrequency: "monthly" as const,
				priority: 0.7,
			}),
		),
		{
			url: baseUrl,
			changeFrequency: "weekly",
			priority: 1,
		},
		{
			url: `${baseUrl}/legal/terms`,
			changeFrequency: "yearly",
			priority: 0.3,
		},
		{
			url: `${baseUrl}/legal/privacy`,
			changeFrequency: "yearly",
			priority: 0.3,
		},
	];
}
