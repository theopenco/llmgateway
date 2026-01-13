import { ArrowLeftIcon } from "lucide-react";
import Markdown from "markdown-to-jsx";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { getMarkdownOptions } from "@/lib/utils/markdown";

import type { Guide } from "content-collections";
import type { Metadata } from "next";

interface GuidePageProps {
	params: Promise<{ slug: string }>;
}

export default async function GuidePage({ params }: GuidePageProps) {
	const { allGuides } = await import("content-collections");

	const { slug } = await params;

	const guide = allGuides.find((guide: Guide) => guide.slug === slug);

	if (!guide) {
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
								href="/guides"
								className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
							>
								<ArrowLeftIcon className="mr-2 h-4 w-4" />
								Back to guides
							</Link>
						</div>

						<article className="prose prose-lg dark:prose-invert max-w-none">
							<header className="mb-8">
								<h1 className="text-4xl font-bold mb-4">{guide.title}</h1>
								<div className="text-muted-foreground">
									{guide.description && (
										<p className="text-lg mb-2">{guide.description}</p>
									)}
								</div>
							</header>

							{guide.image && (
								<div className="mb-8">
									<Image
										src={guide.image.src}
										alt={guide.image.alt || guide.title}
										width={guide.image.width}
										height={guide.image.height}
										className="w-full rounded-lg object-cover"
									/>
								</div>
							)}

							<div className="prose prose-lg dark:prose-invert max-w-none">
								<Markdown options={getMarkdownOptions()}>
									{guide.content}
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
	const { allGuides } = await import("content-collections");

	return allGuides.map((guide: Guide) => ({
		slug: guide.slug,
	}));
}

export async function generateMetadata({
	params,
}: GuidePageProps): Promise<Metadata> {
	const { allGuides } = await import("content-collections");

	const { slug } = await params;

	const guide = allGuides.find((guide: Guide) => guide.slug === slug);

	if (!guide) {
		return {};
	}

	return {
		title: `${guide.title} - Guides - LLM Gateway`,
		description: guide.description || "LLM Gateway integration guide",
		openGraph: {
			title: `${guide.title} - Guides - LLM Gateway`,
			description: guide.description || "LLM Gateway integration guide",
			type: "article",
		},
		twitter: {
			card: "summary_large_image",
			title: `${guide.title} - Guides - LLM Gateway`,
			description: guide.description || "LLM Gateway integration guide",
		},
	};
}
