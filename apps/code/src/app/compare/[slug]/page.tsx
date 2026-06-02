import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import Markdown from "markdown-to-jsx";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ComparisonTable } from "@/components/ComparisonTable";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { CodeCTATracker } from "@/components/LandingTracker";
import { Button } from "@/components/ui/button";
import { getMarkdownOptions } from "@/lib/utils/markdown";

import { allComparisons } from "content-collections";

import type { Comparison } from "content-collections";
import type { Metadata } from "next";

const BASE_URL = "https://devpass.llmgateway.io";

interface ComparePageProps {
	params: Promise<{ slug: string }>;
}

function formatDate(date: string): string {
	return new Date(date).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export function generateStaticParams() {
	return allComparisons
		.filter((entry: Comparison) => !entry.draft)
		.map((entry: Comparison) => ({ slug: entry.slug }));
}

export async function generateMetadata({
	params,
}: ComparePageProps): Promise<Metadata> {
	const { slug } = await params;

	const entry = allComparisons.find((entry: Comparison) => entry.slug === slug);

	if (!entry) {
		return {};
	}

	return {
		title: entry.metaTitle ?? entry.title,
		description: entry.description,
		alternates: { canonical: `/compare/${entry.slug}` },
		openGraph: {
			title: entry.metaTitle ?? entry.title,
			description: entry.description,
			type: "article",
			url: `${BASE_URL}/compare/${entry.slug}`,
		},
		twitter: {
			card: "summary_large_image",
			title: entry.metaTitle ?? entry.title,
			description: entry.description,
		},
	};
}

export default async function ComparePage({ params }: ComparePageProps) {
	const { slug } = await params;

	const entry = allComparisons.find((entry: Comparison) => entry.slug === slug);

	if (!entry || entry.draft) {
		notFound();
	}

	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
			{
				"@type": "ListItem",
				position: 2,
				name: "Compare",
				item: `${BASE_URL}/compare`,
			},
			{
				"@type": "ListItem",
				position: 3,
				name: entry.title,
				item: `${BASE_URL}/compare/${entry.slug}`,
			},
		],
	};

	const faqSchema =
		entry.faqs.length > 0
			? {
					"@context": "https://schema.org",
					"@type": "FAQPage",
					mainEntity: entry.faqs.map((item) => ({
						"@type": "Question",
						name: item.question,
						acceptedAnswer: {
							"@type": "Answer",
							text: item.answer,
						},
					})),
				}
			: null;

	return (
		<div className="min-h-screen bg-background">
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
			/>
			{faqSchema && (
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
				/>
			)}
			<Header />

			<main>
				{/* Hero */}
				<section className="relative overflow-hidden border-b">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-muted/60 via-transparent to-transparent" />
					<div className="container relative mx-auto max-w-4xl px-4 pt-16 pb-12 sm:pt-20">
						<Link
							href="/compare"
							className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							<ArrowLeft className="h-3.5 w-3.5" />
							All comparisons
						</Link>
						<div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
							<Sparkles className="h-3.5 w-3.5" />
							Comparison
						</div>
						<h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
							{entry.title}
						</h1>
						<p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
							{entry.tagline}
						</p>

						<div className="mt-8 flex flex-wrap gap-3">
							<div className="rounded-xl border bg-card px-4 py-3">
								<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
									DevPass
								</div>
								<div className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
									{entry.devpassPrice}
								</div>
							</div>
							<div className="rounded-xl border bg-card px-4 py-3">
								<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
									{entry.competitor}
								</div>
								<div className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
									{entry.competitorPrice}
								</div>
							</div>
						</div>

						<div className="mt-8 flex flex-col gap-3 sm:flex-row">
							<CodeCTATracker cta="get_started" location="compare_hero">
								<Button size="lg" className="gap-2" asChild>
									<Link href="/signup?plan=pro">
										Get your DevPass
										<ArrowRight className="h-4 w-4" />
									</Link>
								</Button>
							</CodeCTATracker>
							<Button size="lg" variant="ghost" asChild>
								<Link href="/pricing">See all plans</Link>
							</Button>
						</div>
					</div>
				</section>

				{/* Verdict */}
				<section className="px-4 py-12">
					<div className="container mx-auto max-w-4xl">
						<div className="rounded-2xl border bg-muted/30 p-6 sm:p-8">
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
								The short version
							</p>
							<p className="text-lg leading-relaxed text-foreground">
								{entry.verdict}
							</p>
						</div>
					</div>
				</section>

				{/* Comparison table */}
				<section className="px-4 pb-4">
					<div className="container mx-auto max-w-4xl">
						<h2 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
							DevPass vs {entry.competitor} at a glance
						</h2>
						<p className="mb-6 text-sm text-muted-foreground">
							{entry.competitorTagline}. Pricing and limits as of{" "}
							{formatDate(entry.date)} — always confirm current details on each
							provider&apos;s site.
						</p>
						<ComparisonTable
							competitor={entry.competitor}
							features={entry.features}
						/>
					</div>
				</section>

				{/* Long-form body */}
				<section className="px-4 py-12">
					<div className="container mx-auto max-w-3xl">
						<article>
							<Markdown options={getMarkdownOptions()}>
								{entry.content}
							</Markdown>
						</article>
					</div>
				</section>

				{/* FAQ */}
				{entry.faqs.length > 0 && (
					<section className="border-t bg-muted/20 px-4 py-16">
						<div className="container mx-auto max-w-3xl">
							<h2 className="mb-8 text-2xl font-bold tracking-tight sm:text-3xl">
								Frequently asked questions
							</h2>
							<div className="divide-y divide-border/60">
								{entry.faqs.map((item) => (
									<div key={item.question} className="py-5">
										<h3 className="text-lg font-medium text-foreground">
											{item.question}
										</h3>
										<p className="mt-2 leading-7 text-muted-foreground">
											{item.answer}
										</p>
									</div>
								))}
							</div>
						</div>
					</section>
				)}

				{/* CTA */}
				<section className="border-t px-4 py-20">
					<div className="container mx-auto max-w-2xl text-center">
						<h2 className="mb-3 text-3xl font-bold tracking-tight">
							One key. Every model.
						</h2>
						<p className="mb-8 text-muted-foreground">
							Start on Pro — most developers ship from there. Switch tiers any
							time, prorated.
						</p>
						<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<CodeCTATracker cta="get_started" location="compare_bottom_cta">
								<Button size="lg" className="gap-2 px-8" asChild>
									<Link href="/signup?plan=pro">
										Get your DevPass
										<ArrowRight className="h-4 w-4" />
									</Link>
								</Button>
							</CodeCTATracker>
							<Button size="lg" variant="ghost" asChild>
								<Link href="/compare">Compare other plans</Link>
							</Button>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
