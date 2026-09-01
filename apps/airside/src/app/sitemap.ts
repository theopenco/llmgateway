import type { MetadataRoute } from "next";

const baseUrl = "https://airside.llmgateway.io";

export default function sitemap(): MetadataRoute.Sitemap {
	const lastModified = new Date();

	return [
		{
			url: baseUrl,
			lastModified,
			changeFrequency: "weekly",
			priority: 1,
		},
		{
			url: `${baseUrl}/legal/terms`,
			lastModified,
			changeFrequency: "yearly",
			priority: 0.3,
		},
		{
			url: `${baseUrl}/legal/privacy`,
			lastModified,
			changeFrequency: "yearly",
			priority: 0.3,
		},
	];
}
