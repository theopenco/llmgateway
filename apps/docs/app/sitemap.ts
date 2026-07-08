import { docsBaseUrl } from "@/lib/base-url";
import { source } from "@/lib/source";

import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
	// No lastModified: stamping a build-time date on every URL marks the whole
	// sitemap as freshly changed on each deploy, which trains crawlers to
	// ignore the field. Omitting it is the truthful option until real
	// per-page modification dates are available.
	return source.getPages().map((page) => {
		const path = page.url === "/" ? "" : page.url;
		return {
			url: `${docsBaseUrl}${path}`,
			changeFrequency: page.url === "/" ? "weekly" : "monthly",
			priority: page.url === "/" ? 1 : 0.7,
		};
	});
}
