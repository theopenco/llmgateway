import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import { getBlogAuthors } from "@/lib/blog-authors";
import { pageTitle } from "@/lib/page-title";

import type { Metadata, Route } from "next";

interface PageProps {
	params: Promise<{ author: string }>;
}

const BASE_URL = "https://llmgateway.io";

async function findAuthor(slug: string) {
	const { allBlogs } = await import("content-collections");
	return getBlogAuthors(allBlogs).find((author) => author.slug === slug);
}

export default async function BlogAuthorPage({ params }: PageProps) {
	const { author: slug } = await params;
	const author = await findAuthor(slug);
	if (!author) {
		notFound();
	}
	const url = `${BASE_URL}/blog/author/${author.slug}`;

	const profileSchema = {
		"@context": "https://schema.org",
		"@type": "ProfilePage",
		url,
		mainEntity: {
			"@type": "Person",
			name: author.name,
			url,
			...(author.bio ? { description: author.bio } : {}),
			...(author.urls.length > 0 ? { sameAs: author.urls } : {}),
			worksFor: {
				"@type": "Organization",
				name: "LLM Gateway",
				url: BASE_URL,
			},
		},
	};
	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
			{
				"@type": "ListItem",
				position: 2,
				name: "Blog",
				item: `${BASE_URL}/blog`,
			},
			{ "@type": "ListItem", position: 3, name: author.name, item: url },
		],
	};

	return (
		<>
			<JsonLd data={[profileSchema, breadcrumbSchema]} />
			<Navbar />
			<main className="min-h-screen bg-background pt-24 pb-16 md:pt-32">
				<div className="container mx-auto max-w-3xl px-4">
					<nav aria-label="Breadcrumb" className="mb-6 text-sm">
						<Link
							href="/blog"
							className="text-muted-foreground hover:text-foreground"
						>
							Blog
						</Link>
					</nav>
					<header className="mb-10">
						<h1 className="text-3xl font-bold tracking-tight md:text-4xl">
							{author.name}
						</h1>
						<p className="mt-3 text-lg text-muted-foreground">
							{author.bio ?? `${author.name} writes for the LLM Gateway blog.`}
						</p>
						{author.urls.length > 0 && (
							<ul className="mt-4 flex flex-wrap gap-4 text-sm">
								{author.urls.map((profileUrl) => (
									<li key={profileUrl}>
										<a
											href={profileUrl}
											rel="me noopener"
											className="font-medium underline underline-offset-4"
										>
											{new URL(profileUrl).hostname.replace(/^www\./, "")}
										</a>
									</li>
								))}
							</ul>
						)}
					</header>
					<section aria-labelledby="author-posts-heading">
						<h2
							id="author-posts-heading"
							className="mb-4 text-xl font-semibold md:text-2xl"
						>
							Posts by {author.name}
						</h2>
						<ul className="space-y-4">
							{author.posts.map((post) => (
								<li key={post.slug} className="rounded-lg border p-5">
									<Link
										href={`/blog/${post.slug}` as Route}
										className="font-semibold hover:underline"
									>
										{post.title}
									</Link>
									<p className="mt-2 text-sm text-muted-foreground">
										{post.summary}
									</p>
									<time
										dateTime={post.date}
										className="mt-2 block text-sm text-muted-foreground"
									>
										{new Date(post.date).toLocaleDateString("en-US", {
											year: "numeric",
											month: "long",
											day: "numeric",
											timeZone: "UTC",
										})}
									</time>
								</li>
							))}
						</ul>
					</section>
				</div>
			</main>
			<Footer />
		</>
	);
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { author: slug } = await params;
	const author = await findAuthor(slug);
	if (!author) {
		return {};
	}
	const title = `${author.name} — Author at the LLM Gateway Blog`;
	const description =
		author.bio ?? `Posts by ${author.name} on the LLM Gateway blog.`;
	const canonical = `${BASE_URL}/blog/author/${author.slug}`;
	return {
		title: pageTitle(title),
		description,
		alternates: { canonical },
		openGraph: { title, description, type: "profile", url: canonical },
		twitter: { card: "summary_large_image", title, description },
	};
}
