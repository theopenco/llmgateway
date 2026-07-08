import { docsBaseUrl } from "@/lib/base-url";
import { source } from "@/lib/source";

import type { MetadataRoute } from "next";

// Metadata routes don't inherit the root layout's force-dynamic; without it
// this route is prerendered at build time with the build-time DOCS_URL
// (usually the fallback) baked in instead of the runtime value.
export const dynamic = "force-dynamic";

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
