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

	return (
		<>
			<HeroRSC navbarOnly />
			<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white pt-30">
				<main className="container mx-auto px-4 py-8">
					<nav className="max-w-4xl mx-auto mb-8" aria-label="Breadcrumb">
						<Link
							href="/migration"
							className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
						>
							<ArrowLeftIcon className="mr-2 h-4 w-4" />
							Back to migration guides
						</Link>
					</nav>

					<article className="prose prose-lg dark:prose-invert max-w-none max-w-4xl mx-auto">
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
						</header>

						<section className="prose prose-lg dark:prose-invert max-w-none">
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
