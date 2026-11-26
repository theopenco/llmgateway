import { slugify } from "@/lib/slugify";

import type { Blog } from "content-collections";

export interface BlogAuthor {
	slug: string;
	name: string;
	bio?: string;
	urls: string[];
	posts: Blog[];
}

export function blogAuthorSlug(name: string): string {
	return slugify(name);
}

/** Named authors with their published posts, newest post first. */
export function getBlogAuthors(allBlogs: Blog[]): BlogAuthor[] {
	const authors = new Map<string, BlogAuthor>();
	const published = allBlogs
		.filter((entry) => !entry.draft && entry.author)
		.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
	for (const entry of published) {
		const author = entry.author!;
		const slug = blogAuthorSlug(author.name);
		const existing = authors.get(slug) ?? {
			slug,
			name: author.name,
			urls: [],
			posts: [],
		};
		existing.bio ??= author.bio;
		if (author.url && !existing.urls.includes(author.url)) {
			existing.urls.push(author.url);
		}
		existing.posts.push(entry);
		authors.set(slug, existing);
	}
	return Array.from(authors.values());
}
