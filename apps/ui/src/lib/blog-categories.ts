import { slugify } from "@/lib/slugify";

import { allBlogs } from "content-collections";

export function getBlogCategories() {
	const categories = new Map<string, string>();
	for (const post of allBlogs) {
		if (post.draft) {
			continue;
		}
		for (const category of post.categories ?? []) {
			const slug = slugify(category);
			if (!categories.has(slug)) {
				categories.set(slug, category);
			}
		}
	}
	return categories;
}

export function findBlogCategoryLabel(slug: string) {
	return getBlogCategories().get(slug) ?? null;
}
