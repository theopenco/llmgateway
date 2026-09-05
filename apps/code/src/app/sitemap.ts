import { allComparisons } from "content-collections";

import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
	const baseUrl = "https://devpass.llmgateway.io";

	const staticPages: MetadataRoute.Sitemap = [
		{
			url: baseUrl,
			changeFrequency: "weekly",
			priority: 1,
		},
		{
			url: `${baseUrl}/coding-models`,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models`,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/pricing`,
			changeFrequency: "weekly",
			priority: 0.9,
		},
		{
			url: `${baseUrl}/claude-code-alternative`,
			changeFrequency: "weekly",
			priority: 0.9,
		},
		{
			url: `${baseUrl}/guides`,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/compare`,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/leaderboard`,
			changeFrequency: "daily",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/data/${new Date().getUTCFullYear()}`,
			changeFrequency: "daily",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/legal/privacy`,
			changeFrequency: "yearly",
			priority: 0.3,
		},
		{
			url: `${baseUrl}/legal/terms`,
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
