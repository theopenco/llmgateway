import { ArrowLeftIcon } from "lucide-react";
import Markdown from "markdown-to-jsx";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { getMarkdownOptions } from "@/lib/utils/markdown";

import type { Blog } from "content-collections";
import type { Metadata } from "next";

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

	return (
		<>
			<HeroRSC navbarOnly />
			<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white pt-30">
				<main className="container mx-auto px-4 py-8">
					<div className="max-w-4xl mx-auto">
						<div className="mb-8">
							<Link
								href="/blog"
								className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
							>
								<ArrowLeftIcon className="mr-2 h-4 w-4" />
								Back to blog
							</Link>
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
										alt={entry.image.alt || entry.title}
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
		title: `${entry.title} - Blog - LLM Gateway`,
		description: entry.summary || "LLM Gateway blog post",
		openGraph: {
			title: `${entry.title} - Blog - LLM Gateway`,
			description: entry.summary || "LLM Gateway blog post",
			type: "article",
			images: entry.image
				? [
						{
							url: entry.image.src,
							width: entry.image.width || 800,
							height: entry.image.height || 400,
							alt: entry.image.alt || entry.title,
						},
					]
				: ["/opengraph.png"],
		},
		twitter: {
			card: "summary_large_image",
			title: `${entry.title} - Blog - LLM Gateway`,
			description: entry.summary || "LLM Gateway blog post",
		},
	};
}
