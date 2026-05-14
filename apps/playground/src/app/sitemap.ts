import { getConfig } from "@/lib/config-server";

import type { MetadataRoute } from "next";

interface ShareListResponse {
	shares: Array<{ id: string; updatedAt: string }>;
}

async function fetchPublicShares(): Promise<ShareListResponse["shares"]> {
	const config = getConfig();
	try {
		const response = await fetch(
			`${config.apiBackendUrl}/public/chats/share?limit=5000`,
			{ cache: "no-store" },
		);
		if (!response.ok) {
			return [];
		}
		const data = (await response.json()) as ShareListResponse;
		return Array.isArray(data.shares) ? data.shares : [];
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
			url: `${baseUrl}/group`,
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
