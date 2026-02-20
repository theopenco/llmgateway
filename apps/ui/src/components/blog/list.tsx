import Image from "next/image";
import Link from "next/link";

import Footer from "@/components/landing/footer";

interface BlogItemImage {
	src: string;
	alt: string;
	width: number;
	height: number;
}

interface BlogItem {
	id: string;
	slug: string;
	date: string;
	title: string;
	summary: string;
	categories?: string[];
	image?: BlogItemImage;
}

function slugify(label: string) {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
}

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
	const categoryList = ["Announcements", "Guides", "Engineering", "Changelog"];

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

				<div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
					{blogEntries.map((entry: BlogItem) => (
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
									<h3 className="text-xl font-semibold leading-tight">
										<Link
											href={`/blog/${entry.slug}`}
											prefetch={true}
											className="hover:underline"
										>
											{entry.title}
										</Link>
									</h3>
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
										{new Date(entry.date).toLocaleDateString("en-US", {
											year: "numeric",
											month: "long",
											day: "numeric",
										})}
									</div>
								</div>
							</div>
						</article>
					))}
				</div>
			</main>
			<Footer />
		</div>
	);
}
