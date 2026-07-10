import { ArrowRight, ArrowUpRight, Sparkles } from "lucide-react";
import Link from "next/link";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { ModelCard } from "@/components/timeline/timeline-parts";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { fetchModels } from "@/lib/fetch-models";
import { serializeJsonLd } from "@/lib/json-ld";
import {
	buildTimelineFaqs,
	buildTimelineModels,
	buildTimelineStats,
	formatDate,
	getYearSummaries,
	isoDate,
	recentModels,
} from "@/lib/timeline-data";

import type { Metadata } from "next";

const BASE_URL = "https://llmgateway.io";

export const metadata: Metadata = {
	title: "LLM Release Timeline — Model Release Dates",
	description:
		"Release dates for every major LLM — see when GPT, Claude, Gemini, Llama, Mistral, and DeepSeek models shipped and when each was added to LLM Gateway.",
	alternates: {
		canonical: "/timeline",
	},
	openGraph: {
		title: "LLM Release Timeline — Model Release Dates",
		description:
			"Release dates for every major LLM — GPT, Claude, Gemini, Llama, Mistral and DeepSeek — with the date each model was added to LLM Gateway.",
		type: "website",
		url: `${BASE_URL}/timeline`,
	},
	twitter: {
		card: "summary_large_image",
		title: "LLM Release Timeline — Model Release Dates",
		description:
			"Release dates for every major LLM — GPT, Claude, Gemini, Llama, Mistral and DeepSeek — and when each was added to LLM Gateway.",
	},
};

export default async function TimelinePage() {
	const models = await fetchModels();

	const timelineModels = buildTimelineModels(models);
	const stats = buildTimelineStats(timelineModels, models);
	const faqs = buildTimelineFaqs(timelineModels, stats);
	const yearSummaries = getYearSummaries(timelineModels);
	const latest = recentModels(timelineModels, 12);

	const datasetSchema = {
		"@context": "https://schema.org",
		"@type": "Dataset",
		name: "LLM Model Release Timeline",
		description:
			"A continuously updated dataset of large language model releases: the provider release date and the date each model was added to LLM Gateway.",
		url: `${BASE_URL}/timeline`,
		keywords: [
			"LLM release dates",
			"AI model timeline",
			"GPT release date",
			"Claude release date",
			"Gemini release date",
			"language model history",
		],
		creator: {
			"@type": "Organization",
			name: "LLM Gateway",
			url: BASE_URL,
		},
		isAccessibleForFree: true,
		...(stats.firstYear
			? {
					temporalCoverage: `${stats.firstYear}-01-01/${
						stats.latestReleasedAt?.slice(0, 10) ?? ".."
					}`,
				}
			: {}),
		...(stats.latestReleasedAt
			? { dateModified: stats.latestReleasedAt.slice(0, 10) }
			: {}),
		variableMeasured: ["Provider release date", "Date added to LLM Gateway"],
	};

	const itemListSchema = {
		"@context": "https://schema.org",
		"@type": "ItemList",
		name: "LLM releases by year",
		numberOfItems: yearSummaries.length,
		itemListElement: yearSummaries.map((summary, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: `LLMs released in ${summary.year}`,
			url: `${BASE_URL}/timeline/${summary.year}`,
		})),
	};

	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
			{
				"@type": "ListItem",
				position: 2,
				name: "Model Timeline",
				item: `${BASE_URL}/timeline`,
			},
		],
	};

	const faqSchema = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: faqs.map((faq) => ({
			"@type": "Question",
			name: faq.question,
			acceptedAnswer: { "@type": "Answer", text: faq.answer },
		})),
	};

	return (
		<>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(datasetSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemListSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqSchema) }}
			/>

			<Navbar />

			<main className="relative min-h-screen overflow-hidden bg-background pt-20 md:pt-24">
				<div
					aria-hidden
					className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(56,189,248,0.12)_0%,transparent_70%)]"
				/>

				<section className="border-b border-border/60">
					<div className="container mx-auto px-4 py-12 md:py-16">
						<div className="mx-auto max-w-3xl space-y-5 text-center">
							<Badge
								variant="outline"
								className="gap-1.5 rounded-full px-3 py-1 text-xs"
							>
								<Sparkles className="h-3.5 w-3.5 text-sky-400" />
								Model release timeline
							</Badge>
							<h1 className="font-display text-3xl font-bold tracking-tight text-balance md:text-5xl">
								When every LLM was released
							</h1>
							<p className="mx-auto max-w-2xl text-balance text-sm text-muted-foreground md:text-base">
								A continuously updated timeline of large language model releases
								— when each model shipped from its provider and when it landed
								on LLM Gateway. Track GPT, Claude, Gemini, Llama, Mistral,
								DeepSeek and more. Browse the full history by year.
							</p>

							<dl className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 pt-2 text-sm">
								<div className="flex items-baseline gap-1.5">
									<dd className="font-display text-xl font-bold tabular-nums text-foreground">
										{stats.totalModels}
									</dd>
									<dt className="text-muted-foreground">models</dt>
								</div>
								<span aria-hidden className="text-border">
									•
								</span>
								<div className="flex items-baseline gap-1.5">
									<dd className="font-display text-xl font-bold tabular-nums text-foreground">
										{stats.totalProviders}
									</dd>
									<dt className="text-muted-foreground">providers</dt>
								</div>
								{stats.firstYear ? (
									<>
										<span aria-hidden className="text-border">
											•
										</span>
										<div className="flex items-baseline gap-1.5">
											<dd className="text-muted-foreground">since</dd>
											<dt className="font-display text-xl font-bold tabular-nums text-foreground">
												{stats.firstYear}
											</dt>
										</div>
									</>
								) : null}
								{stats.latestReleasedAt ? (
									<>
										<span aria-hidden className="text-border">
											•
										</span>
										<div className="flex items-center gap-1.5">
											<span className="relative flex h-2 w-2">
												<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
												<span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
											</span>
											<span className="text-muted-foreground">
												Updated{" "}
												<time
													dateTime={isoDate(stats.latestReleasedAt)}
													className="font-medium text-foreground"
												>
													{formatDate(stats.latestReleasedAt)}
												</time>
											</span>
										</div>
									</>
								) : null}
							</dl>
						</div>
					</div>
				</section>

				<section className="container mx-auto px-4 py-12 md:py-16">
					<div className="mx-auto max-w-5xl">
						<div className="mb-8">
							<h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
								Browse by year
							</h2>
							<p className="mt-2 text-sm text-muted-foreground">
								Jump to the models released in a given year.
							</p>
						</div>

						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{yearSummaries.map((summary) => (
								<Link
									key={summary.year}
									href={`/timeline/${summary.year}`}
									className="group flex flex-col rounded-xl border border-border/70 bg-card/50 p-5 backdrop-blur transition-all hover:border-primary/40 hover:bg-card hover:shadow-md"
								>
									<div className="flex items-baseline justify-between">
										<h3 className="font-display text-2xl font-bold tabular-nums">
											{summary.year}
										</h3>
										<span className="text-sm text-muted-foreground">
											{summary.count} {summary.count === 1 ? "model" : "models"}
										</span>
									</div>
									{summary.providers.length ? (
										<p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
											{summary.providers.slice(0, 4).join(" · ")}
										</p>
									) : null}
									{summary.highlights.length ? (
										<p className="mt-3 line-clamp-2 text-sm text-foreground/80">
											{summary.highlights.join(", ")}
										</p>
									) : null}
									<span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary">
										View {summary.year} releases
										<ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
									</span>
								</Link>
							))}
						</div>
					</div>
				</section>

				{latest.length ? (
					<section className="border-t border-border/60 bg-muted/20">
						<div className="container mx-auto px-4 py-12 md:py-16">
							<div className="mx-auto max-w-5xl">
								<div className="mb-8 flex items-end justify-between gap-4">
									<div>
										<h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
											Latest releases
										</h2>
										<p className="mt-2 text-sm text-muted-foreground">
											The most recently released models, newest first.
										</p>
									</div>
									{stats.firstYear ? (
										<Button
											asChild
											variant="outline"
											size="sm"
											className="shrink-0 rounded-full"
										>
											<Link href={`/timeline/${yearSummaries[0]?.year ?? ""}`}>
												See all {yearSummaries[0]?.year}
												<ArrowRight className="ml-1 h-3.5 w-3.5" />
											</Link>
										</Button>
									) : null}
								</div>

								<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
									{latest.map((model) => (
										<ModelCard
											key={model.id}
											model={model}
											latestReleasedAt={stats.latestReleasedAt}
										/>
									))}
								</div>
							</div>
						</div>
					</section>
				) : null}

				<section
					className="border-t border-border/60"
					aria-labelledby="timeline-faq-heading"
				>
					<div className="container mx-auto max-w-3xl px-4 py-14 md:py-20">
						<div className="mb-8 text-center">
							<p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
								FAQ
							</p>
							<h2
								id="timeline-faq-heading"
								className="font-display text-2xl font-bold tracking-tight md:text-3xl"
							>
								LLM release dates, answered
							</h2>
						</div>
						<dl className="divide-y divide-border/60">
							{faqs.map((faq) => (
								<div key={faq.question} className="py-5">
									<dt className="font-display text-base font-semibold md:text-lg">
										{faq.question}
									</dt>
									<dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
										{faq.answer}
									</dd>
								</div>
							))}
						</dl>
					</div>
				</section>

				<section className="border-t border-border/60">
					<div className="container mx-auto px-4 py-14 md:py-20">
						<div className="mx-auto flex max-w-3xl flex-col items-center gap-5 rounded-2xl border border-border/70 bg-card/50 px-6 py-10 text-center backdrop-blur md:py-12">
							<h2 className="font-display text-2xl font-bold tracking-tight text-balance md:text-3xl">
								Route to any of these models with one API
							</h2>
							<p className="max-w-xl text-balance text-sm text-muted-foreground md:text-base">
								Switch to the newest model the day it ships — no new SDK, no
								vendor lock-in. One key for every provider on this timeline.
							</p>
							<div className="flex flex-wrap items-center justify-center gap-3">
								<Button asChild size="lg" className="rounded-full">
									<Link href="/signup">
										Get your API key
										<ArrowRight className="ml-1 h-4 w-4" />
									</Link>
								</Button>
								<Button
									asChild
									size="lg"
									variant="outline"
									className="rounded-full"
								>
									<Link href="/models">Browse all models</Link>
								</Button>
							</div>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</>
	);
}
