import { ArrowLeftIcon } from "lucide-react";
import Markdown from "markdown-to-jsx";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { getMarkdownOptions } from "@/lib/utils/markdown";

import type { Migration } from "content-collections";
import type { Metadata } from "next";

interface MigrationPageProps {
	params: Promise<{ slug: string }>;
}

export default async function MigrationPage({ params }: MigrationPageProps) {
	const { allMigrations } = await import("content-collections");

	const { slug } = await params;

	const migration = allMigrations.find(
		(migration: Migration) => migration.slug === slug,
	);

	if (!migration) {
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
								href="/migration"
								className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
							>
								<ArrowLeftIcon className="mr-2 h-4 w-4" />
								Back to migration guides
							</Link>
						</div>

						<article className="prose prose-lg dark:prose-invert max-w-none">
							<header className="mb-8">
								<div className="mb-4 inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
									From {migration.fromProvider}
								</div>
								<h1 className="text-4xl font-bold mb-4">{migration.title}</h1>
								<div className="text-muted-foreground">
									{migration.description && (
										<p className="text-lg mb-2">{migration.description}</p>
									)}
								</div>
							</header>

							<div className="prose prose-lg dark:prose-invert max-w-none">
								<Markdown options={getMarkdownOptions()}>
									{migration.content}
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
	const { allMigrations } = await import("content-collections");

	return allMigrations.map((migration: Migration) => ({
		slug: migration.slug,
	}));
}

export async function generateMetadata({
	params,
}: MigrationPageProps): Promise<Metadata> {
	const { allMigrations } = await import("content-collections");

	const { slug } = await params;

	const migration = allMigrations.find(
		(migration: Migration) => migration.slug === slug,
	);

	if (!migration) {
		return {};
	}

	return {
		title: `${migration.title} - Migration Guides - LLM Gateway`,
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
