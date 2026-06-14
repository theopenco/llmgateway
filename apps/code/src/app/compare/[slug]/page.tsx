import { ArrowLeft, ArrowRight } from "lucide-react";
import Markdown from "markdown-to-jsx";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandTile } from "@/components/brand-logos";
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

function Pole({
	brand,
	name,
	caption,
	price,
	recommended,
}: {
	brand: string;
	name: string;
	caption: string;
	price: string;
	recommended?: boolean;
}) {
	return (
		<div
			className={`relative flex flex-col items-center rounded-2xl border bg-card px-6 py-7 text-center ${
				recommended
					? "border-foreground/30 shadow-md ring-1 ring-foreground/10"
					: ""
			}`}
		>
			{recommended && (
				<span className="absolute -top-2.5 rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-background">
					Our pick
				</span>
			)}
			<BrandTile brand={brand} size={56} radius={16} />
			<div className="mt-3 text-base font-semibold tracking-tight text-foreground">
				{name}
			</div>
			<p className="mt-1 min-h-[32px] text-xs leading-5 text-muted-foreground">
				{caption}
			</p>
			<div className="mt-3 font-mono text-sm font-semibold tabular-nums text-foreground">
				{price}
			</div>
		</div>
	);
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
				{/* Hero — versus arena */}
				<section className="relative overflow-hidden border-b">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_55%_at_50%_-5%,_var(--tw-gradient-stops))] from-muted/70 via-transparent to-transparent" />
					<div
						className="pointer-events-none absolute inset-0 opacity-[0.04]"
						style={{
							backgroundImage:
								"linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
							backgroundSize: "44px 44px",
							maskImage:
								"radial-gradient(ellipse 70% 55% at 50% 0%, black, transparent)",
						}}
					/>
					<div className="container relative mx-auto max-w-3xl px-4 pt-16 pb-14 sm:pt-20">
						<Link
							href="/compare"
							className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							<ArrowLeft className="h-3.5 w-3.5" />
							All comparisons
						</Link>

						<div className="text-center">
							<div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
								Head to head
							</div>
							<h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
								{entry.title}
							</h1>
							<p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-pretty text-muted-foreground">
								{entry.tagline}
							</p>
						</div>

						{/* Arena */}
						<div className="relative mt-10 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr]">
							<Pole
								brand="devpass"
								name="DevPass"
								caption="One key, 200+ models at provider rates"
								price={entry.devpassPrice}
								recommended
							/>
							<div className="flex items-center justify-center">
								<div className="flex h-11 w-11 items-center justify-center rounded-full border bg-background text-xs font-bold uppercase tracking-wider text-muted-foreground shadow-sm">
									vs
								</div>
							</div>
							<Pole
								brand={entry.competitorLogo ?? entry.competitor}
								name={entry.competitor}
								caption={entry.competitorTagline}
								price={entry.competitorPrice}
							/>
						</div>

						<div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
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
							competitorLogo={entry.competitorLogo}
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
						<div className="mb-6 flex items-center justify-center gap-3">
							<BrandTile brand="devpass" size={44} radius={12} />
						</div>
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
