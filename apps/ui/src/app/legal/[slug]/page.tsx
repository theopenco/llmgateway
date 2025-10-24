import { ArrowLeftIcon } from "lucide-react";
import Markdown from "markdown-to-jsx";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { getMarkdownOptions } from "@/lib/utils/markdown";

import type { Legal } from "content-collections";
import type { Metadata } from "next";

interface LegalEntryPageProps {
	params: Promise<{ slug: string }>;
}

export default async function LegalEntryPage({ params }: LegalEntryPageProps) {
	const { allLegals } = await import("content-collections");

	const { slug } = await params;

	const entry = allLegals.find((entry: Legal) => entry.slug === slug);

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
								href="/"
								className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
							>
								<ArrowLeftIcon className="mr-2 h-4 w-4" />
								Back Home
							</Link>
						</div>

						<article className="prose prose-lg dark:prose-invert max-w-none">
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
	const { allLegals } = await import("content-collections");

	return allLegals.map((entry: Legal) => ({
		slug: entry.slug,
	}));
}

export async function generateMetadata({
	params,
}: LegalEntryPageProps): Promise<Metadata> {
	const { allLegals } = await import("content-collections");

	const { slug } = await params;

	const entry = allLegals.find((entry: Legal) => entry.slug === slug);

	if (!entry) {
		return {};
	}

	return {
		title: `${entry.title} - LLM Gateway`,
		description: entry.description || "LLM Gateway legal post",
		openGraph: {
			title: `${entry.title} - LLM Gateway`,
			description: entry.description || "LLM Gateway legal post",
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: `${entry.title} - LLM Gateway`,
			description: entry.description || "LLM Gateway legal post",
		},
	};
}
