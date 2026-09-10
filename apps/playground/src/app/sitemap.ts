import { connection } from "next/server";
import createFetchClient from "openapi-fetch";

import { comparisons } from "@/lib/comparisons";
import { getConfig } from "@/lib/config-server";

import type { paths } from "@/lib/api/v1";
import type { MetadataRoute } from "next";

interface ShareListItem {
	id: string;
	updatedAt: string;
}

export const revalidate = 3600;

async function fetchPublicShares(): Promise<ShareListItem[]> {
	const config = getConfig();
	const client = createFetchClient<paths>({
		baseUrl: config.apiBackendUrl,
	});
	const { data, error } = await client.GET("/public/chats/share", {
		params: { query: { limit: 5000 } },
		next: { revalidate: 3600 },
	});
	if (error || !data) {
		throw new Error("Unable to load public chat shares for the sitemap");
	}
	return data.shares;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	await connection();

	const baseUrl = "https://lounge.llmgateway.io";

	const staticEntries: MetadataRoute.Sitemap = [
		{
			url: baseUrl,
			changeFrequency: "daily",
			priority: 1,
		},
		{
			url: `${baseUrl}/image`,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/video`,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/audio`,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/group`,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/canvas`,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/pricing`,
			changeFrequency: "weekly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/realtime`,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/escape`,
			changeFrequency: "weekly",
			priority: 0.7,
		},
		{
			url: `${baseUrl}/leaderboard`,
			changeFrequency: "daily",
			priority: 0.6,
		},
		{
			url: `${baseUrl}/compare`,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		...comparisons.map((comparison) => ({
			url: `${baseUrl}/compare/${comparison.slug}`,
			changeFrequency: "weekly" as const,
			priority: 0.7,
		})),
	];

	const shares = await fetchPublicShares();
	const shareEntries: MetadataRoute.Sitemap = shares.map((share) => ({
		url: `${baseUrl}/share/${share.id}`,
		lastModified: new Date(share.updatedAt),
		changeFrequency: "monthly",
		priority: 0.6,
	}));

	return [...staticEntries, ...shareEntries];
}
