import { ogContentType, ogImage, ogSize } from "@/lib/og";
import { slugify } from "@/lib/slugify";

import { allBlogs } from "content-collections";

export const size = ogSize;
export const contentType = ogContentType;

// Satori cannot run at request time in production; prerender every category.
export const dynamicParams = false;

export function generateStaticParams() {
	const slugs = new Set<string>();
	for (const post of allBlogs) {
		if (post.draft) {
			continue;
		}
		(post.categories ?? []).forEach((c: string) => slugs.add(slugify(c)));
	}
	return Array.from(slugs).map((category) => ({ category }));
}

function findCategoryLabel(slug: string) {
	for (const post of allBlogs) {
		if (post.draft) {
			continue;
		}
		for (const category of post.categories ?? []) {
			if (slugify(category) === slug) {
				return category;
			}
		}
	}
	return null;
}

export default async function BlogCategoryOgImage({
	params,
}: {
	params: Promise<{ category: string }>;
}) {
	const { category } = await params;
	const label = findCategoryLabel(category) ?? "Blog";
	return ogImage({
		eyebrow: "Blog",
		title: label,
		subtitle: `Articles in the ${label} category — news, tutorials, and product updates from the LLM Gateway team.`,
	});
}
