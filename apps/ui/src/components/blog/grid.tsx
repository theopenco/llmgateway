"use client";

import Image from "next/image";
import Link from "next/link";

import {
	ContentSearch,
	NoSearchResults,
	useContentSearch,
} from "@/components/content-search";
import { queryMatcher } from "@/lib/content-search";
import { slugify } from "@/lib/slugify";

export interface BlogGridItem {
	id: string;
	slug: string;
	date: string;
	title: string;
	summary: string;
	categories?: string[];
	image?: { src: string; alt: string; width: number; height: number };
	author?: { name: string };
}

/** The post cards of a blog listing, with a search over the same posts. */
export function BlogGrid({
	entries,
	searchLabel,
}: {
	entries: BlogGridItem[];
	searchLabel: string;
}) {
	const [query, setQuery] = useContentSearch();
	const matchesEntry = queryMatcher(query);
	const matches = entries.filter((entry) =>
		matchesEntry([
			entry.title,
			entry.summary,
			entry.author?.name,
			...(entry.categories ?? []),
		]),
	);

	return (
		<>
			<div className="mb-8">
				<ContentSearch
					label={searchLabel}
					placeholder="Search posts"
					query={query}
					onQueryChange={setQuery}
					resultCount={matches.length}
					noun="post"
				/>
			</div>
			{matches.length === 0 && query.trim() && (
				<NoSearchResults
					query={query}
					noun="post"
					onClear={() => setQuery("")}
				/>
			)}
			<div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
				{matches.map((entry) => (
					<article
						key={entry.id}
						className="group border border-border rounded-xl overflow-hidden bg-card"
					>
						<div className="block">
							<Link
								href={`/blog/${entry.slug}`}
								prefetch={true}
								className="block"
							>
								{entry?.image ? (
									<Image
										src={entry.image.src}
										alt={entry.image.alt}
										width={entry.image.width}
										height={entry.image.height}
										className="h-48 w-full object-cover transition-opacity group-hover:opacity-90"
									/>
								) : (
									<div className="h-48 w-full bg-muted" />
								)}
							</Link>
							<div className="p-5 space-y-3">
								<h2 className="text-xl font-semibold leading-tight">
									<Link
										href={`/blog/${entry.slug}`}
										prefetch={true}
										className="hover:underline"
									>
										{entry.title}
									</Link>
								</h2>
								{entry?.categories && entry.categories.length > 0 && (
									<div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
										{entry.categories.map((cat) => (
											<Link
												key={cat}
												href={`/blog/category/${encodeURIComponent(slugify(cat))}`}
												className="underline hover:text-foreground"
												prefetch={true}
											>
												{cat}
											</Link>
										))}
									</div>
								)}
								<p className="text-sm text-muted-foreground line-clamp-3">
									{entry.summary}
								</p>
								<div className="text-xs text-muted-foreground">
									{entry.author && <p>By {entry.author.name}</p>}
									{new Date(entry.date).toLocaleDateString("en-US", {
										year: "numeric",
										month: "long",
										day: "numeric",
										timeZone: "UTC",
									})}
								</div>
							</div>
						</div>
					</article>
				))}
			</div>
		</>
	);
}
