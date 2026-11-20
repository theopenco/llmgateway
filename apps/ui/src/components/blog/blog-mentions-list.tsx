import Link from "next/link";

import { mentionsModel, mentionsProvider } from "@/lib/content-mentions";

import type { Route } from "next";

const MAX_POSTS = 5;

/** Blog posts that name a model or provider, newest first. */
export async function BlogMentionsList({
	kind,
	id,
	name,
}: {
	kind: "model" | "provider";
	id: string;
	name: string;
}) {
	const { allBlogs } = await import("content-collections");
	const matches = kind === "model" ? mentionsModel : mentionsProvider;
	const posts = allBlogs
		.filter((entry) => !entry.draft && matches(entry.content, id))
		.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
		.slice(0, MAX_POSTS);
	if (posts.length === 0) {
		return null;
	}
	return (
		<div>
			<h2 className="mb-4 text-xl font-semibold md:text-2xl">
				{name} on the blog
			</h2>
			<ul className="grid gap-3 sm:grid-cols-2">
				{posts.map((post) => (
					<li key={post.slug}>
						<Link
							href={`/blog/${post.slug}` as Route}
							className="block h-full rounded-lg border p-4 transition-colors hover:bg-muted/40"
						>
							<p className="font-medium">{post.title}</p>
							<p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
								{post.summary}
							</p>
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}
