import Link from "next/link";

import { BlogGrid } from "@/components/blog/grid";
import Footer from "@/components/landing/footer";
import { slugify } from "@/lib/slugify";

import { allBlogs } from "content-collections";

import type { BlogGridItem } from "@/components/blog/grid";

type BlogItem = BlogGridItem;

interface BlogListProps {
	entries?: BlogItem[];
	selectedCategory?: string; // slug form
	heading?: string;
	subheading?: string;
}

export function BlogList({
	entries,
	selectedCategory,
	heading = "Blog",
	subheading = "Latest news and updates from LLM Gateway",
}: BlogListProps = {}) {
	const blogEntries = entries ?? [];
	const categoryList = [
		...allBlogs
			.filter((entry) => !entry.draft)
			.flatMap((entry) => entry.categories ?? []),
		"Changelog",
	].filter(
		(category, index, categories) => categories.indexOf(category) === index,
	);

	return (
		<div className="bg-background text-foreground min-h-screen font-sans pt-30">
			<main className="container mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
				<div className="mb-8">
					<h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
						{heading}
					</h1>
					<p className="text-muted-foreground mt-3">{subheading}</p>
				</div>

				{categoryList.length > 0 && (
					<nav className="flex flex-wrap gap-3 mb-10">
						<Link
							href="/blog"
							prefetch={true}
							className={`px-4 py-2 rounded-full text-sm border transition-colors ${!selectedCategory ? "bg-foreground text-background" : "border-border hover:bg-muted"}`}
						>
							Overview
						</Link>
						{categoryList.map((cat) => {
							const catSlug = slugify(cat);
							const active = selectedCategory === catSlug;
							return (
								<Link
									key={cat}
									href={
										cat === "Changelog"
											? "/changelog"
											: `/blog/category/${encodeURIComponent(catSlug)}`
									}
									prefetch={true}
									className={`px-4 py-2 rounded-full text-sm border transition-colors ${active ? "bg-foreground text-background" : "border-border hover:bg-muted"}`}
								>
									{cat}
								</Link>
							);
						})}
					</nav>
				)}

				<BlogGrid
					entries={blogEntries.map((entry) => ({
						id: entry.id,
						slug: entry.slug,
						date: entry.date,
						title: entry.title,
						summary: entry.summary,
						categories: entry.categories,
						image: entry.image,
						author: entry.author && { name: entry.author.name },
					}))}
					searchLabel={`Search ${heading}`}
				/>
			</main>
			<Footer />
		</div>
	);
}
