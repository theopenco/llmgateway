import { docsBaseUrl } from "@/lib/base-url";
import { marketingGuideCanonical } from "@/lib/guide-canonical";
import { source } from "@/lib/source";

import type { MetadataRoute } from "next";

// Metadata routes don't inherit the root layout's force-dynamic; without it
// this route is prerendered at build time with the build-time DOCS_URL
// (usually the fallback) baked in instead of the runtime value.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
	// Guides that canonicalize cross-domain to llmgateway.io are excluded:
	// a sitemap must only list canonical URLs, and listing an alternate here
	// contradicts its canonical tag.
	return source
		.getPages()
		.filter((page) => marketingGuideCanonical(page.url) === null)
		.map((page) => {
			const path = page.url === "/" ? "" : page.url;
			return {
				url: `${docsBaseUrl}${path}`,
				lastModified: page.data.lastModified,
				changeFrequency: page.url === "/" ? "weekly" : "monthly",
				priority: page.url === "/" ? 1 : 0.7,
			};
		});
}
