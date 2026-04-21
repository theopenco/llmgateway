import { ArrowLeftIcon } from "lucide-react";
import Markdown from "markdown-to-jsx";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { getMarkdownOptions } from "@/lib/utils/markdown";

import { CopyMarkdownButton } from "./copy-markdown-button";

import type { Changelog } from "content-collections";
import type { Metadata } from "next";

interface ChangelogEntryPageProps {
	params: Promise<{ slug: string }>;
}

export default async function ChangelogEntryPage({
	params,
}: ChangelogEntryPageProps) {
	const { allChangelogs } = await import("content-collections");

	const { slug } = await params;

	const entry = allChangelogs.find((entry: Changelog) => entry.slug === slug);

	if (!entry) {
		notFound();
	}

	const articleSchema = {
		"@context": "https://schema.org",
		"@type": "Article",
		headline: entry.title,
		description: entry.summary ?? "LLM Gateway changelog entry",
		datePublished: entry.date,
		dateModified: entry.date,
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
			"@id": `https://llmgateway.io/changelog/${slug}`,
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
				name: "Changelog",
				item: "https://llmgateway.io/changelog",
			},
			{
				"@type": "ListItem",
				position: 3,
				name: entry.title,
				item: `https://llmgateway.io/changelog/${slug}`,
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
			<HeroRSC navbarOnly />

			<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white pt-30">
				<main className="container mx-auto px-4 py-8">
					<div className="max-w-4xl mx-auto">
						<div className="mb-8 flex items-center justify-between">
							<Link
								href="/changelog"
								className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
							>
								<ArrowLeftIcon className="mr-2 h-4 w-4" />
								Back to changelog
							</Link>
							<CopyMarkdownButton content={entry.content} />
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
								</div>
							</header>

							{entry.image && (
								<div className="mb-8">
									<Image
										src={entry.image.src}
										alt={entry.image.alt ?? entry.title}
										width={entry.image.width}
										height={entry.image.height}
										className="w-full rounded-lg object-cover"
									/>
								</div>
							)}

							<div className="prose prose-lg dark:prose-invert max-w-none">
								<Markdown options={getMarkdownOptions()}>
									{entry.content}
								</Markdown>
							</div>
						</article>
					</div>
				</main>
				<Footer />
			</div>
		</>
	);
}

export async function generateStaticParams() {
	const { allChangelogs } = await import("content-collections");

	return allChangelogs.map((entry) => ({
		slug: entry.slug,
	}));
}

export async function generateMetadata({
	params,
}: ChangelogEntryPageProps): Promise<Metadata> {
	const { allChangelogs } = await import("content-collections");

	const { slug } = await params;

	const entry = allChangelogs.find((entry: Changelog) => entry.slug === slug);

	if (!entry) {
		return {};
	}

	return {
		title: `${entry.title} - Changelog`,
		description: entry.summary ?? "LLM Gateway changelog entry",
		openGraph: {
			title: `${entry.title} - Changelog - LLM Gateway`,
			description: entry.summary ?? "LLM Gateway changelog entry",
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
			title: `${entry.title} - Changelog - LLM Gateway`,
			description: entry.summary ?? "LLM Gateway changelog entry",
		},
	};
}
