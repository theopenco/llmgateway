import { ArrowLeftIcon } from "lucide-react";
import Markdown from "markdown-to-jsx";
import dynamic from "next/dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { getMarkdownOptions } from "@/lib/utils/markdown";

import { allMigrations } from "content-collections";

import type { Metadata } from "next";

const Footer = dynamic(() => import("@/components/landing/footer"));

interface MigrationPageProps {
	params: Promise<{ slug: string }>;
}

export default async function MigrationPage({ params }: MigrationPageProps) {
	const { slug } = await params;

	const migration = allMigrations.find((migration) => migration.slug === slug);

	if (!migration) {
		notFound();
	}

	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "TechArticle",
		headline: migration.title,
		description: migration.description ?? "Migration guide for LLM Gateway",
		datePublished: migration.date,
		dateModified: migration.date,
		author: {
			"@type": "Organization",
			name: "LLM Gateway",
			url: "https://llmgateway.io",
		},
		publisher: {
			"@type": "Organization",
			name: "LLM Gateway",
			url: "https://llmgateway.io",
		},
		mainEntityOfPage: {
			"@type": "WebPage",
			"@id": `https://llmgateway.io/migration/${slug}`,
		},
	};

	const formattedDate = new Date(migration.date).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});

	return (
		<>
			<HeroRSC navbarOnly />
			<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white pt-30">
				<main className="container mx-auto px-4 py-8">
					<script
						type="application/ld+json"
						// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
						dangerouslySetInnerHTML={{
							__html: JSON.stringify(jsonLd),
						}}
					/>
					<nav className="max-w-4xl mx-auto mb-8" aria-label="Breadcrumb">
						<ol>
							<li>
								<Link
									href="/migration"
									className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
								>
									<ArrowLeftIcon className="mr-2 h-4 w-4" />
									Back to migration guides
								</Link>
							</li>
						</ol>
					</nav>

					<article className="prose prose-lg dark:prose-invert max-w-4xl mx-auto">
						<header className="mb-8">
							<span className="mb-4 inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
								From {migration.fromProvider}
							</span>
							<h1 className="text-4xl font-bold mb-4">{migration.title}</h1>
							{migration.description && (
								<p className="text-lg text-muted-foreground mb-2">
									{migration.description}
								</p>
							)}
							<p className="text-sm text-muted-foreground">
								Published <time dateTime={migration.date}>{formattedDate}</time>
							</p>
						</header>

						<section
							className="prose prose-lg dark:prose-invert max-w-none"
							aria-label="Migration guide content"
						>
							<Markdown options={getMarkdownOptions()}>
								{migration.content}
							</Markdown>
						</section>
					</article>
				</main>
				<Footer />
			</div>
		</>
	);
}

export async function generateStaticParams() {
	return allMigrations.map((migration) => ({
		slug: migration.slug,
	}));
}

export async function generateMetadata({
	params,
}: MigrationPageProps): Promise<Metadata> {
	const { slug } = await params;

	const migration = allMigrations.find((migration) => migration.slug === slug);

	if (!migration) {
		return {};
	}

	return {
		title: `${migration.title} - Migration Guides`,
		description: migration.description ?? "Migration guide for LLM Gateway",
		openGraph: {
			title: `${migration.title} - Migration Guides - LLM Gateway`,
			description: migration.description ?? "Migration guide for LLM Gateway",
			type: "article",
		},
		twitter: {
			card: "summary_large_image",
			title: `${migration.title} - Migration Guides - LLM Gateway`,
			description: migration.description ?? "Migration guide for LLM Gateway",
		},
	};
}
