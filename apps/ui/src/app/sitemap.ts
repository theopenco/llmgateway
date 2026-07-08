import { enterpriseFeatures } from "@/lib/enterprise-features";
import { features } from "@/lib/features";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@llmgateway/models";

import type { MetadataRoute } from "next";

function slugify(label: string) {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
}

// Stable per-deploy timestamp. Using a single build-time date (instead of a
// fresh `new Date()` per URL/request) keeps `lastModified` from reporting
// "changed just now" on every crawl, which trains search engines to ignore it.
const buildDate = new Date();

// Most recent provider release date across the catalog. Used as the timeline
// page's `lastModified` so it reflects real content freshness (a new model)
// rather than the deploy time.
const latestModelReleaseDate = (() => {
	let latest = new Date(0);
	for (const model of modelDefinitions) {
		if ("releasedAt" in model && model.releasedAt) {
			const date = new Date(model.releasedAt);
			if (!Number.isNaN(date.getTime()) && date.getTime() > latest.getTime()) {
				latest = date;
			}
		}
	}
	return latest.getTime() === 0 ? buildDate : latest;
})();

// Distinct release years across the catalog plus the latest release date within
// each year, used to emit /timeline/{year} hub children. Using the per-year
// latest release as `lastModified` keeps historical year pages from reporting a
// change on every deploy.
const timelineYears = (() => {
	const latestByYear = new Map<number, Date>();
	for (const model of modelDefinitions) {
		if ("releasedAt" in model && model.releasedAt) {
			const date = new Date(model.releasedAt);
			if (Number.isNaN(date.getTime())) {
				continue;
			}
			const year = date.getUTCFullYear();
			const current = latestByYear.get(year);
			if (!current || date.getTime() > current.getTime()) {
				latestByYear.set(year, date);
			}
		}
	}
	return Array.from(latestByYear.entries())
		.map(([year, lastModified]) => ({ year, lastModified }))
		.sort((a, b) => b.year - a.year);
})();

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const baseUrl = "https://llmgateway.io";

	const {
		allBlogs,
		allGuides,
		allChangelogs,
		allLegals,
		allMigrations,
		allUseCases,
	} = await import("content-collections");

	// Static pages
	const staticPages: MetadataRoute.Sitemap = [
		{
			url: baseUrl,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 1,
		},
		{
			url: `${baseUrl}/models`,
			lastModified: buildDate,
			changeFrequency: "daily",
			priority: 0.9,
		},
		{
			url: `${baseUrl}/pricing`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.9,
		},
		{
			url: `${baseUrl}/blog`,
			lastModified: buildDate,
			changeFrequency: "daily",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/guides`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/changelog`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/providers`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/enterprise`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/open-source`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/integrations`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/referrals`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.6,
		},
		{
			url: `${baseUrl}/timeline`,
			lastModified: latestModelReleaseDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/brand`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.4,
		},
		{
			url: `${baseUrl}/migration`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/reliability`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/ship`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/token-cost-calculator`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.9,
		},
		{
			url: `${baseUrl}/nano-banana-simulator/20`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.6,
		},
		{
			url: `${baseUrl}/blog/category`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.5,
		},
		{
			url: `${baseUrl}/models/compare`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/models/text`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/vision`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/reasoning`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/web-search`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/image-to-image`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/text-to-image`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/video`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/embeddings`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/tools`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/discounted`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/models/roleplay`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/coding`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/creative-writing`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/translation`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/math`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/long-context`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/cheapest`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/models/open-source`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/mcp`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/agents`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/templates`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/apps`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/compare/aws-bedrock`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/compare/azure-ai-foundry`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/compare/litellm`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/compare/open-router`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/compare/portkey`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/compare/vercel-ai-gateway`,
			lastModified: buildDate,
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/use-cases`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		},
	];

	// Model pages
	const modelPages: MetadataRoute.Sitemap = [];
	for (const model of modelDefinitions) {
		// Main model page
		modelPages.push({
			url: `${baseUrl}/models/${encodeURIComponent(model.id)}`,
			lastModified: "releasedAt" in model ? model.releasedAt : buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		});

		// Model uptime page
		modelPages.push({
			url: `${baseUrl}/models/${encodeURIComponent(model.id)}/uptime`,
			lastModified: buildDate,
			changeFrequency: "daily",
			priority: 0.5,
		});

		// Model + provider sub-pages (/models/{id}/{provider}) are intentionally
		// excluded from the sitemap: they canonicalize to the base model page
		// (/models/{id}), so listing them here only inflates Search Console's
		// "Alternate page with proper canonical tag" report without adding any
		// indexable URLs. Google still discovers them via internal links.
	}

	// Provider pages
	const providerPages: MetadataRoute.Sitemap = providerDefinitions
		.filter((provider) => provider.name !== "LLM Gateway")
		.map((provider) => ({
			url: `${baseUrl}/providers/${provider.id}`,
			lastModified: buildDate,
			changeFrequency: "weekly",
			priority: 0.8,
		}));

	// Feature pages
	const featurePages: MetadataRoute.Sitemap = features.map((feature) => ({
		url: `${baseUrl}/features/${feature.slug}`,
		lastModified: buildDate,
		changeFrequency: "monthly",
		priority: 0.7,
	}));

	// Enterprise feature subpages
	const enterpriseFeaturePages: MetadataRoute.Sitemap = enterpriseFeatures.map(
		(feature) => ({
			url: `${baseUrl}/enterprise/${feature.slug}`,
			lastModified: buildDate,
			changeFrequency: "monthly" as const,
			priority: 0.8,
		}),
	);

	// Blog pages
	const blogPages: MetadataRoute.Sitemap = allBlogs
		.filter((blog) => !blog.draft)
		.map((blog) => ({
			url: `${baseUrl}/blog/${blog.slug}`,
			lastModified: new Date(blog.date),
			changeFrequency: "monthly" as const,
			priority: 0.6,
		}));

	// Blog category pages
	const blogCategorySlugs = new Set<string>();
	for (const blog of allBlogs) {
		if (blog.draft) {
			continue;
		}
		for (const category of blog.categories ?? []) {
			blogCategorySlugs.add(slugify(category));
		}
	}
	const blogCategoryPages: MetadataRoute.Sitemap = Array.from(
		blogCategorySlugs,
	).map((category) => ({
		url: `${baseUrl}/blog/category/${encodeURIComponent(category)}`,
		lastModified: buildDate,
		changeFrequency: "weekly" as const,
		priority: 0.5,
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

	// Use case pages
	const useCasePages: MetadataRoute.Sitemap = allUseCases
		.filter((useCase) => !useCase.draft)
		.map((useCase) => ({
			url: `${baseUrl}/use-cases/${useCase.slug}`,
			lastModified: new Date(useCase.date),
			changeFrequency: "monthly" as const,
			priority: 0.7,
		}));

	// Per-year timeline hub children (/timeline/{year})
	const currentYear = buildDate.getFullYear();
	const timelineYearPages: MetadataRoute.Sitemap = timelineYears.map(
		({ year, lastModified }) => ({
			url: `${baseUrl}/timeline/${year}`,
			lastModified,
			changeFrequency: year === currentYear ? "weekly" : "monthly",
			priority: year === currentYear ? 0.7 : 0.6,
		}),
	);

	return [
		...staticPages,
		...timelineYearPages,
		...modelPages,
		...providerPages,
		...featurePages,
		...enterpriseFeaturePages,
		...blogPages,
		...blogCategoryPages,
		...guidePages,
		...changelogPages,
		...legalPages,
		...migrationPages,
		...useCasePages,
	];
}
