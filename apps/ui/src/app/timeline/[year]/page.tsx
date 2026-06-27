import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { TimelineList } from "@/components/timeline/timeline-list";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { fetchModels } from "@/lib/fetch-models";
import { serializeJsonLd } from "@/lib/json-ld";
import {
	buildTimelineModels,
	buildTimelineStats,
	buildYearFaqs,
	formatDate,
	getTimelineYears,
	getYearSummaries,
	isoDate,
	modelsForYear,
} from "@/lib/timeline-data";

import type { Metadata } from "next";

const BASE_URL = "https://llmgateway.io";

interface YearPageProps {
	params: Promise<{ year: string }>;
}

export async function generateMetadata({
	params,
}: YearPageProps): Promise<Metadata> {
	const { year } = await params;

	if (!/^\d{4}$/.test(year)) {
		return { title: "Model Timeline" };
	}

	const title = `LLMs Released in ${year} — AI Model Release Dates`;
	const description = `Every large language model released in ${year}: provider release dates for GPT, Claude, Gemini, Llama, Mistral, DeepSeek and more, with the date each was added to LLM Gateway.`;

	return {
		title,
		description,
		alternates: {
			canonical: `/timeline/${year}`,
		},
		openGraph: {
			title,
			description,
			type: "website",
			url: `${BASE_URL}/timeline/${year}`,
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}

export default async function TimelineYearPage({ params }: YearPageProps) {
	const { year } = await params;

	if (!/^\d{4}$/.test(year)) {
		notFound();
	}

	const models = await fetchModels();
	const timelineModels = buildTimelineModels(models);
	const years = getTimelineYears(timelineModels);

	if (!years.includes(year)) {
		notFound();
	}

	const stats = buildTimelineStats(timelineModels, models);
	const yearModels = modelsForYear(timelineModels, year);
	const summary = getYearSummaries(timelineModels).find(
		(item) => item.year === year,
	)!;
	const faqs = buildYearFaqs(year, yearModels, summary);

	// years are newest-first; "newer" sits before the current year in the list
	const currentIndex = years.indexOf(year);
	const newerYear = currentIndex > 0 ? years[currentIndex - 1] : null;
	const olderYear =
		currentIndex < years.length - 1 ? years[currentIndex + 1] : null;

	const itemListSchema = {
		"@context": "https://schema.org",
		"@type": "ItemList",
		name: `LLMs released in ${year}`,
		numberOfItems: yearModels.length,
		itemListElement: yearModels.map((model, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: `${model.name} (${model.providerName})`,
			url: `${BASE_URL}/models/${encodeURIComponent(model.id)}`,
		})),
	};

	const datasetSchema = {
		"@context": "https://schema.org",
		"@type": "Dataset",
		name: `LLM releases in ${year}`,
		description: `Large language models released in ${year}, with provider release dates and the date each was added to LLM Gateway.`,
		url: `${BASE_URL}/timeline/${year}`,
		isPartOf: { "@type": "Dataset", "@id": `${BASE_URL}/timeline` },
		temporalCoverage: `${year}-01-01/${year}-12-31`,
		creator: { "@type": "Organization", name: "LLM Gateway", url: BASE_URL },
		isAccessibleForFree: true,
		...(summary.latestInYearAt
			? { dateModified: summary.latestInYearAt.slice(0, 10) }
			: {}),
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
			{
				"@type": "ListItem",
				position: 3,
				name: year,
				item: `${BASE_URL}/timeline/${year}`,
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
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemListSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(datasetSchema) }}
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
					<div className="container mx-auto px-4 py-10 md:py-14">
						<nav
							aria-label="Breadcrumb"
							className="mb-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
						>
							<Link href="/timeline" className="hover:text-foreground">
								Model timeline
							</Link>
							<span aria-hidden>/</span>
							<span className="font-medium text-foreground">{year}</span>
						</nav>

						<div className="mx-auto max-w-3xl space-y-5 text-center">
							<Badge
								variant="outline"
								className="gap-1.5 rounded-full px-3 py-1 text-xs"
							>
								<Sparkles className="h-3.5 w-3.5 text-sky-400" />
								Release timeline
							</Badge>
							<h1 className="font-display text-3xl font-bold tracking-tight text-balance md:text-5xl">
								AI models released in {year}
							</h1>
							<p className="mx-auto max-w-2xl text-balance text-sm text-muted-foreground md:text-base">
								{summary.count} large language{" "}
								{summary.count === 1 ? "model" : "models"} from{" "}
								{summary.providerCount} providers shipped in {year} and are
								available on LLM Gateway. See each provider release date and
								when it was added to the gateway.
							</p>

							<dl className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 pt-2 text-sm">
								<div className="flex items-baseline gap-1.5">
									<dd className="font-display text-xl font-bold tabular-nums text-foreground">
										{summary.count}
									</dd>
									<dt className="text-muted-foreground">models</dt>
								</div>
								<span aria-hidden className="text-border">
									•
								</span>
								<div className="flex items-baseline gap-1.5">
									<dd className="font-display text-xl font-bold tabular-nums text-foreground">
										{summary.flagshipCount}
									</dd>
									<dt className="text-muted-foreground">flagship</dt>
								</div>
								{summary.latestInYearAt ? (
									<>
										<span aria-hidden className="text-border">
											•
										</span>
										<div className="flex items-baseline gap-1.5">
											<dd className="text-muted-foreground">latest</dd>
											<dt className="font-medium text-foreground">
												<time dateTime={isoDate(summary.latestInYearAt)}>
													{formatDate(summary.latestInYearAt)}
												</time>
											</dt>
										</div>
									</>
								) : null}
							</dl>

							<nav
								aria-label="Browse other years"
								className="flex flex-wrap items-center justify-center gap-1.5 pt-2"
							>
								{years.map((item) => (
									<Link
										key={item}
										href={`/timeline/${item}`}
										aria-current={item === year ? "page" : undefined}
										className={
											item === year
												? "rounded-full border border-transparent bg-primary px-3 py-1 text-xs font-medium tabular-nums text-primary-foreground"
												: "rounded-full border border-border bg-background px-3 py-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-muted"
										}
									>
										{item}
									</Link>
								))}
							</nav>
						</div>
					</div>
				</section>

				<section className="container mx-auto px-4 py-10 md:py-14">
					<TimelineList
						models={yearModels}
						latestReleasedAt={stats.latestReleasedAt}
					/>
				</section>

				{newerYear || olderYear ? (
					<section className="border-t border-border/60">
						<div className="container mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-8">
							{olderYear ? (
								<Button asChild variant="outline" className="rounded-full">
									<Link href={`/timeline/${olderYear}`}>
										<ArrowLeft className="mr-1 h-4 w-4" />
										{olderYear} releases
									</Link>
								</Button>
							) : (
								<span />
							)}
							{newerYear ? (
								<Button asChild variant="outline" className="rounded-full">
									<Link href={`/timeline/${newerYear}`}>
										{newerYear} releases
										<ArrowRight className="ml-1 h-4 w-4" />
									</Link>
								</Button>
							) : (
								<span />
							)}
						</div>
					</section>
				) : null}

				<section
					className="border-t border-border/60 bg-muted/20"
					aria-labelledby="year-faq-heading"
				>
					<div className="container mx-auto max-w-3xl px-4 py-14 md:py-20">
						<div className="mb-8 text-center">
							<p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
								FAQ
							</p>
							<h2
								id="year-faq-heading"
								className="font-display text-2xl font-bold tracking-tight md:text-3xl"
							>
								{year} LLM releases, answered
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
								Use any {year} model with one API
							</h2>
							<p className="max-w-xl text-balance text-sm text-muted-foreground md:text-base">
								Route to every model on this list through a single
								OpenAI-compatible API — no new SDK, no vendor lock-in.
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
