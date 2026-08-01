import Link from "next/link";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { slugify } from "@/lib/slugify";

import { allBlogs } from "content-collections";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Blog Categories",
	description:
		"Browse LLM Gateway blog posts by category — product updates, tutorials, deep-dives, and more.",
	alternates: { canonical: "/blog/category" },
	openGraph: {
		title: "Blog Categories | LLM Gateway",
		description:
			"Browse LLM Gateway blog posts by category — product updates, tutorials, deep-dives, and more.",
		url: "https://llmgateway.io/blog/category",
		type: "website",
		images: ["/opengraph.png?v=2"],
	},
};

export default function BlogCategoryIndexPage() {
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

	const sorted = Array.from(categories.entries()).sort((a, b) =>
		a[1].localeCompare(b[1]),
	);

	return (
		<>
			<HeroRSC navbarOnly />
			<div className="container mx-auto max-w-3xl px-4 py-16 pt-28 md:pt-36">
				<h1 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
					Blog Categories
				</h1>
				<p className="mb-10 text-muted-foreground">
					Browse posts by topic across the LLM Gateway blog.
				</p>
				{sorted.length === 0 ? (
					<p className="text-muted-foreground">
						No categories yet.{" "}
						<Link href="/blog" className="text-primary underline">
							View all posts
						</Link>
						.
					</p>
				) : (
					<ul className="grid gap-3 sm:grid-cols-2">
						{sorted.map(([slug, label]) => (
							<li key={slug}>
								<Link
									href={`/blog/category/${encodeURIComponent(slug)}`}
									className="block rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted"
								>
									{label}
								</Link>
							</li>
						))}
					</ul>
				)}
			</div>
		</>
	);
}
