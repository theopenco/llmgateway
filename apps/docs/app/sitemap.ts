import { source } from "@/lib/source";

import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
	const docsBaseUrl = process.env.DOCS_URL ?? "https://docs.llmgateway.io";
	const buildDate = new Date();

	return source.getPages().map((page) => {
		const path = page.url === "/" ? "" : page.url;
		return {
			url: `${docsBaseUrl}${path}`,
			lastModified: buildDate,
			changeFrequency: page.url === "/" ? "weekly" : "monthly",
			priority: page.url === "/" ? 1 : 0.7,
		};
	});
}
