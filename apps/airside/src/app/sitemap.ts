import type { MetadataRoute } from "next";

const baseUrl = "https://airside.llmgateway.io";

export default function sitemap(): MetadataRoute.Sitemap {
	return [
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
