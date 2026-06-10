import createFetchClient from "openapi-fetch";

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
	try {
		const { data } = await client.GET("/public/chats/share", {
			params: { query: { limit: 5000 } },
			next: { revalidate: 3600 },
		});
		return data?.shares ?? [];
	} catch {
		return [];
	}
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const baseUrl = "https://chat.llmgateway.io";
	const now = new Date();

	const staticEntries: MetadataRoute.Sitemap = [
		{
			url: baseUrl,
			lastModified: now,
			changeFrequency: "daily",
			priority: 1,
		},
		{
			url: `${baseUrl}/image`,
			lastModified: now,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/video`,
			lastModified: now,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/audio`,
			lastModified: now,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/group`,
			lastModified: now,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${baseUrl}/canvas`,
			lastModified: now,
			changeFrequency: "weekly",
			priority: 0.8,
		},
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
