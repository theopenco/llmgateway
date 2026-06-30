import { allComparisons } from "content-collections";

import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
	const baseUrl = "https://devpass.llmgateway.io";

	const staticPages: MetadataRoute.Sitemap = [
		{
			url: baseUrl,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 1,
		},
		{
			url: `${baseUrl}/coding-models`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/pricing`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.9,
		},
		{
			url: `${baseUrl}/guides`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/compare`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/leaderboard`,
			lastModified: new Date(),
			changeFrequency: "daily",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/legal/privacy`,
			lastModified: new Date(),
			changeFrequency: "yearly",
			priority: 0.3,
		},
		{
			url: `${baseUrl}/legal/terms`,
			lastModified: new Date(),
			changeFrequency: "yearly",
			priority: 0.3,
		},
	];

	const comparisonPages: MetadataRoute.Sitemap = allComparisons
		.filter((entry) => !entry.draft)
		.map((entry) => ({
			url: `${baseUrl}/compare/${entry.slug}`,
			lastModified: new Date(entry.date),
			changeFrequency: "monthly" as const,
			priority: 0.7,
		}));

	return [...staticPages, ...comparisonPages];
}
