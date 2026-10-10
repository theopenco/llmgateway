"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { ChangelogTags } from "@/components/changelog-tags";
import {
	changelogPageSize,
	changelogPath,
	changelogProducts,
	changelogTags,
} from "@/lib/changelog";

import { formatNumber } from "@llmgateway/shared/number-format";

import type { ChangelogTag } from "@/lib/changelog";
import type { ChangelogFrontmatter } from "@/lib/utils/markdown";

interface ChangelogProps {
	entries: ChangelogFrontmatter[];
	tag?: ChangelogTag;
	page: number;
}

export function Changelog({ entries, tag, page }: ChangelogProps) {
	const [visiblePage, setVisiblePage] = useState(page);
	const start = (page - 1) * changelogPageSize;
	const end = visiblePage * changelogPageSize;
	const changelogEntries = entries.slice(start, end);
	const hasMore = end < entries.length;

	return (
		<div className="bg-background text-foreground min-h-screen font-sans pt-30">
			<main className="container mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
				<div className="mb-12 md:mb-16">
					<div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4">
						<h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
							{tag ? `${changelogProducts[tag].name} changelog` : "Changelog"}
						</h1>
					</div>
					<p className="text-muted-foreground">
						{tag
							? changelogProducts[tag].description
							: "The latest features, improvements, and fixes across LLM Gateway, DevPass, Lounge, and Airside."}
					</p>
					<nav
						aria-label="Filter changelog by product"
						className="mt-8 flex flex-wrap gap-2"
					>
						{[undefined, ...changelogTags].map((product) => (
							<Link
								key={product ?? "all"}
								href={changelogPath(product)}
								aria-current={product === tag ? "page" : undefined}
								className={`inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${product === tag ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"}`}
							>
								{product ? changelogProducts[product].name : "All products"}
							</Link>
						))}
					</nav>
				</div>

				{page > 1 && (
					<Link
						href={changelogPath(tag, page - 1)}
						className="mb-8 block text-sm text-muted-foreground hover:text-foreground"
					>
						← Newer updates
					</Link>
				)}
				<div className="space-y-16 max-w-5xl mx-auto">
					{changelogEntries.map((entry, index) => (
						<article
							key={entry.slug}
							className="grid md:grid-cols-[150px_1fr] gap-x-8 gap-y-4"
						>
							<div className="md:sticky md:top-24 md:self-start z-20 bg-background/80 backdrop-blur supports-backdrop-blur:bg-background/60">
								<time
									dateTime={entry.date}
									className="block text-sm text-muted-foreground md:text-right pt-1"
								>
									{new Date(entry.date).toLocaleDateString("en-US", {
										year: "numeric",
										month: "long",
										day: "numeric",
										timeZone: "UTC",
									})}
								</time>
							</div>
							<div className="space-y-8">
								<div className="space-y-4">
									<ChangelogTags tags={entry.tags} />
									<h2 className="text-2xl font-medium text-foreground hover:text-muted-foreground transition-colors">
										<Link href={`/changelog/${entry.slug}`} prefetch={false}>
											{entry.title}
										</Link>
									</h2>
									<p className="text-muted-foreground leading-relaxed">
										{entry.summary}
									</p>
									<Link
										href={`/changelog/${entry.slug}`}
										className="text-sm text-primary hover:text-primary/80"
										prefetch={false}
									>
										Read more
										<span className="sr-only"> about {entry.title}</span> &rarr;
									</Link>
								</div>
								<div className="bg-card border border-border rounded-lg overflow-hidden">
									<Link href={`/changelog/${entry.slug}`} prefetch={false}>
										<Image
											loading={index === 0 ? "eager" : "lazy"}
											sizes="(min-width: 1024px) 846px, (min-width: 768px) calc(100vw - 230px), calc(100vw - 32px)"
											src={entry.image.src}
											alt={entry.image.alt}
											width={entry.image.width}
											height={entry.image.height}
											className="w-full h-64 object-cover hover:opacity-90 transition-opacity rounded-lg object-top"
										/>
									</Link>
								</div>
							</div>
						</article>
					))}
				</div>
				<div className="mt-16 flex flex-col items-center gap-4">
					<p role="status" className="text-sm text-muted-foreground">
						Showing {formatNumber(changelogEntries.length)} of{" "}
						{formatNumber(entries.length)} updates
					</p>
					{hasMore && (
						<Link
							href={changelogPath(tag, visiblePage + 1)}
							prefetch={false}
							scroll={false}
							onNavigate={(event) => {
								event.preventDefault();
								setVisiblePage((current) => current + 1);
							}}
							className="inline-flex min-h-11 items-center justify-center rounded-full border border-border px-6 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						>
							Load more
						</Link>
					)}
				</div>
			</main>
		</div>
	);
}
