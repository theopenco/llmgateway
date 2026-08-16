import { ArrowLeftIcon } from "lucide-react";
import Markdown from "markdown-to-jsx";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContentConversionRail } from "@/components/content-conversion-rail";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { getMarkdownOptions } from "@/lib/utils/markdown";
import { plainTextFromMarkdown } from "@/lib/utils/plain-text";

import { CopyMarkdownButton } from "./copy-markdown-button";

import type { Blog } from "content-collections";
import type { Metadata } from "next";

/**
 * The rendered page appends the `faqs` frontmatter as its own section, so the
 * copied markdown has to do the same — otherwise "copy as markdown" silently
 * drops the Q&A that is visible on the page.
 */
function markdownWithFaqs(entry: Blog): string {
	if (!entry.faqs.length) {
		return entry.content;
	}
	const section = entry.faqs
		.map((faq) => `### ${faq.question}\n\n${faq.answer}`)
		.join("\n\n");
	return `${entry.content.trimEnd()}\n\n## Frequently asked questions\n\n${section}\n`;
}

interface BlogEntryPageProps {
	params: Promise<{ slug: string }>;
}

export default async function BlogEntryPage({ params }: BlogEntryPageProps) {
	const { allBlogs } = await import("content-collections");

	const { slug } = await params;

	const entry = allBlogs.find((entry: Blog) => entry.slug === slug);

	if (!entry) {
		notFound();
	}

	const articleSchema = {
		"@context": "https://schema.org",
		"@type": "Article",
		headline: entry.title,
		description: entry.summary ?? "LLM Gateway blog post",
		datePublished: entry.date,
		dateModified: entry.updatedAt ?? entry.date,
		author: {
			"@type": "Organization",
			name: "LLM Gateway",
			url: "https://llmgateway.io",
		},
		publisher: {
			"@type": "Organization",
			name: "LLM Gateway",
			url: "https://llmgateway.io",
			logo: {
				"@type": "ImageObject",
				url: "https://llmgateway.io/favicon/android-chrome-512x512.png",
			},
		},
		mainEntityOfPage: {
			"@type": "WebPage",
			"@id": `https://llmgateway.io/blog/${slug}`,
		},
		...(entry.image && {
			image: {
				"@type": "ImageObject",
				url: entry.image.src.startsWith("http")
					? entry.image.src
					: `https://llmgateway.io${entry.image.src}`,
				width: entry.image.width,
				height: entry.image.height,
			},
		}),
	};

	const faqSchema = entry.faqs.length
		? {
				"@context": "https://schema.org",
				"@type": "FAQPage",
				mainEntity: entry.faqs.map((faq) => ({
					"@type": "Question",
					name: faq.question,
					acceptedAnswer: {
						"@type": "Answer",
						text: plainTextFromMarkdown(faq.answer),
					},
				})),
			}
		: null;

	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{
				"@type": "ListItem",
				position: 1,
				name: "Home",
				item: "https://llmgateway.io",
			},
			{
				"@type": "ListItem",
				position: 2,
				name: "Blog",
				item: "https://llmgateway.io/blog",
			},
			{
				"@type": "ListItem",
				position: 3,
				name: entry.title,
				item: `https://llmgateway.io/blog/${slug}`,
			},
		],
	};

	return (
		<>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(articleSchema),
				}}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(breadcrumbSchema),
				}}
			/>
			{faqSchema ? (
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(faqSchema),
					}}
				/>
			) : null}
			<HeroRSC navbarOnly />
			<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white pt-30">
				<main className="container mx-auto px-4 py-8">
					<div className="max-w-4xl mx-auto">
						<div className="mb-8 flex items-center justify-between">
							<Link
								href="/blog"
								className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
							>
								<ArrowLeftIcon className="mr-2 h-4 w-4" />
								Back to blog
							</Link>
							<CopyMarkdownButton content={markdownWithFaqs(entry)} />
						</div>

						<article className="prose prose-lg dark:prose-invert max-w-none">
							<header className="mb-8">
								<h1 className="text-4xl font-bold mb-4">{entry.title}</h1>
								<div className="text-muted-foreground">
									{entry.summary && (
										<p className="text-lg mb-2">{entry.summary}</p>
									)}
									<time dateTime={entry.date} className="text-sm italic">
										{new Date(entry.date).toLocaleDateString("en-US", {
											year: "numeric",
											month: "long",
											day: "numeric",
										})}
									</time>
									{entry.updatedAt && (
										<span className="text-sm italic">
											{" · Updated "}
											<time dateTime={entry.updatedAt}>
												{new Date(entry.updatedAt).toLocaleDateString("en-US", {
													year: "numeric",
													month: "long",
													day: "numeric",
												})}
											</time>
										</span>
									)}
								</div>
							</header>

							{entry.image && (
								<div className="mb-8">
									<Image
										src={entry.image.src}
										alt={entry.image.alt ?? entry.title}
										width={entry.image.width}
										height={entry.image.height}
										sizes="(max-width: 768px) 100vw, 768px"
										className="w-full rounded-lg object-cover"
										priority
									/>
								</div>
							)}

							<div className="prose prose-lg dark:prose-invert max-w-none">
								<Markdown options={getMarkdownOptions()}>
									{entry.content}
								</Markdown>
							</div>

							{entry.faqs.length ? (
								<section
									aria-labelledby="blog-faq-heading"
									className="mt-12 border-t border-border pt-8"
								>
									<h2 id="blog-faq-heading" className="text-2xl font-bold mb-6">
										Frequently asked questions
									</h2>
									<dl className="divide-y divide-border">
										{entry.faqs.map((faq) => (
											<div key={faq.question} className="py-5">
												<dt className="text-lg font-semibold">
													{faq.question}
												</dt>
												<dd className="mt-2 leading-relaxed text-muted-foreground">
													{/* Answers carry the same inline links and code spans
													    the body copy does, so they render as markdown
													    rather than escaping to literal syntax. */}
													<Markdown options={getMarkdownOptions()}>
														{faq.answer}
													</Markdown>
												</dd>
											</div>
										))}
									</dl>
								</section>
							) : null}
						</article>
					</div>
				</main>
				<Footer />
			</div>
			<ContentConversionRail
				surface="blog"
				// Follow whichever offer the post's inline cards already make, so the
				// rail reinforces them instead of competing.
				variant={
					entry.content.includes('variant="devpass"') ? "devpass" : "gateway"
				}
				model={entry.model}
			/>
		</>
	);
}

export async function generateStaticParams() {
	const { allBlogs } = await import("content-collections");

	return allBlogs.map((entry: Blog) => ({
		slug: entry.slug,
	}));
}

export async function generateMetadata({
	params,
}: BlogEntryPageProps): Promise<Metadata> {
	const { allBlogs } = await import("content-collections");

	const { slug } = await params;

	const entry = allBlogs.find((entry: Blog) => entry.slug === slug);

	if (!entry) {
		return {};
	}

	return {
		title: entry.title,
		description: entry.summary ?? "LLM Gateway blog post",
		openGraph: {
			title: entry.title,
			description: entry.summary ?? "LLM Gateway blog post",
			type: "article",
			images: entry.image
				? [
						{
							url: entry.image.src,
							width: entry.image.width ?? 800,
							height: entry.image.height ?? 400,
							alt: entry.image.alt ?? entry.title,
						},
					]
				: ["/opengraph.png"],
		},
		twitter: {
			card: "summary_large_image",
			title: entry.title,
			description: entry.summary ?? "LLM Gateway blog post",
		},
	};
}
