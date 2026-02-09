import { features } from "@/lib/features";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@llmgateway/models";

import type { MetadataRoute } from "next";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const baseUrl = "https://llmgateway.io";

	const { allBlogs, allGuides, allChangelogs, allLegals, allMigrations } =
		await import("content-collections");

	// Static pages
	const staticPages: MetadataRoute.Sitemap = [
		{
			url: baseUrl,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 1,
		},
		{
			url: `${baseUrl}/models`,
			lastModified: new Date(),
			changeFrequency: "daily",
			priority: 0.9,
		},
		{
			url: `${baseUrl}/pricing`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.9,
		},
		{
			url: `${baseUrl}/blog`,
			lastModified: new Date(),
			changeFrequency: "daily",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/guides`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/changelog`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/providers`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/enterprise`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/integrations`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/referrals`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.6,
		},
		{
			url: `${baseUrl}/timeline`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.5,
		},
		{
			url: `${baseUrl}/brand`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.4,
		},
		{
			url: `${baseUrl}/migration`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/models/compare`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/mcp`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/agents`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/templates`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/compare/litellm`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/compare/open-router`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.7,
		},
	];

	// Model pages
	const modelPages: MetadataRoute.Sitemap = [];
	for (const model of modelDefinitions) {
		// Main model page
		modelPages.push({
			url: `${baseUrl}/models/${encodeURIComponent(model.id)}`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.8,
		});

		// Model + provider pages
		const uniqueProviders = Array.from(
			new Set(model.providers.map((p) => p.providerId)),
		);
		for (const providerId of uniqueProviders) {
			modelPages.push({
				url: `${baseUrl}/models/${encodeURIComponent(model.id)}/${encodeURIComponent(providerId)}`,
				lastModified: new Date(),
				changeFrequency: "weekly",
				priority: 0.7,
			});
		}
	}

	// Provider pages
	const providerPages: MetadataRoute.Sitemap = providerDefinitions
		.filter((provider) => provider.name !== "LLM Gateway")
		.map((provider) => ({
			url: `${baseUrl}/providers/${provider.id}`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.8,
		}));

	// Feature pages
	const featurePages: MetadataRoute.Sitemap = features.map((feature) => ({
		url: `${baseUrl}/features/${feature.slug}`,
		lastModified: new Date(),
		changeFrequency: "monthly",
		priority: 0.7,
	}));

	// Blog pages
	const blogPages: MetadataRoute.Sitemap = allBlogs
		.filter((blog) => !blog.draft)
		.map((blog) => ({
			url: `${baseUrl}/blog/${blog.slug}`,
			lastModified: new Date(blog.date),
			changeFrequency: "monthly" as const,
			priority: 0.6,
		}));

	// Guide pages
	const guidePages: MetadataRoute.Sitemap = allGuides.map((guide) => ({
		url: `${baseUrl}/guides/${guide.slug}`,
		lastModified: new Date(guide.date),
		changeFrequency: "monthly" as const,
		priority: 0.7,
	}));

	// Changelog pages
	const changelogPages: MetadataRoute.Sitemap = allChangelogs
		.filter((changelog) => !changelog.draft)
		.map((changelog) => ({
			url: `${baseUrl}/changelog/${changelog.slug}`,
			lastModified: new Date(changelog.date),
			changeFrequency: "monthly" as const,
			priority: 0.5,
		}));

	// Legal pages
	const legalPages: MetadataRoute.Sitemap = allLegals.map((legal) => ({
		url: `${baseUrl}/legal/${legal.slug}`,
		lastModified: new Date(legal.date),
		changeFrequency: "yearly" as const,
		priority: 0.3,
	}));

	// Migration pages
	const migrationPages: MetadataRoute.Sitemap = allMigrations.map(
		(migration) => ({
			url: `${baseUrl}/migration/${migration.slug}`,
			lastModified: new Date(migration.date),
			changeFrequency: "monthly" as const,
			priority: 0.6,
		}),
	);

	return [
		...staticPages,
		...modelPages,
		...providerPages,
		...featurePages,
		...blogPages,
		...guidePages,
		...changelogPages,
		...legalPages,
		...migrationPages,
	];
}
