import { ClipboardCheck, Stamp } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Footer } from "@/components/Footer";
import { GetDevPassButton } from "@/components/GetDevPassButton";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { FIRST_SURVEY_YEAR, fetchModelSurveyResults } from "@/lib/model-survey";

import type { ModelSurveyModel } from "@/lib/model-survey";
import type { Metadata } from "next";

const BASE_URL = "https://devpass.llmgateway.io";

export const revalidate = 300;

const USE_CASE_LABELS: Record<string, string> = {
	agentic_coding: "Agentic coding",
	code_completion: "Autocomplete",
	code_review: "Code review",
	debugging: "Debugging",
	writing_tests: "Writing tests",
	docs_and_explanations: "Docs",
	other: "Other",
};

function parseYear(raw: string): number | null {
	if (!/^\d{4}$/.test(raw)) {
		return null;
	}
	const year = Number(raw);
	const currentYear = new Date().getUTCFullYear();
	if (year < FIRST_SURVEY_YEAR || year > currentYear) {
		return null;
	}
	return year;
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ year: string }>;
}): Promise<Metadata> {
	const { year: rawYear } = await params;
	const year = parseYear(rawYear);
	if (!year) {
		return {};
	}
	const title = `The ${year} DevPass Model Census — coding models rated by the developers who pay for them`;
	const description = `Value, quality, and speed scores for coding models, rated only by DevPass developers with verified real-world usage. No benchmarks, no vibes — shipped-code verdicts.`;
	return {
		title,
		description,
		alternates: { canonical: `/data/${year}` },
		openGraph: {
			title,
			description,
			type: "website",
			url: `${BASE_URL}/data/${year}`,
		},
		twitter: {
			card: "summary_large_image",
			title: `The ${year} DevPass Model Census`,
			description,
		},
	};
}

function ScoreMeter({ label, value }: { label: string; value: number }) {
	return (
		<div className="flex items-center gap-2">
			<span className="w-14 shrink-0 font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
				{label}
			</span>
			<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800 sm:w-24 sm:flex-none">
				<div
					className="h-full rounded-full bg-emerald-600 dark:bg-emerald-400"
					style={{ width: `${(value / 5) * 100}%` }}
				/>
			</div>
			<span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums">
				{value.toFixed(1)}
			</span>
		</div>
	);
}

function ModelRow({ model, rank }: { model: ModelSurveyModel; rank: number }) {
	const topUseCase = model.useCases[0];
	return (
		<div className="border-b border-dashed border-stone-300/80 px-4 py-5 last:border-b-0 dark:border-stone-700/80 sm:flex sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-4 sm:px-6">
			<div className="flex min-w-0 items-center gap-4 sm:flex-1">
				<div
					className={
						rank === 1
							? "flex h-10 w-10 shrink-0 rotate-[-6deg] items-center justify-center rounded-full border-[3px] border-double border-emerald-700/70 font-mono text-sm font-bold text-emerald-800 mix-blend-multiply dark:border-emerald-400/60 dark:text-emerald-300 dark:mix-blend-screen"
							: "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-stone-300 font-mono text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400"
					}
				>
					{rank}
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate font-mono text-sm font-semibold">
						{model.modelId}
					</div>
					<div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
						{model.responseCount} verified ratings
						{topUseCase
							? ` · mostly ${USE_CASE_LABELS[topUseCase.useCase] ?? topUseCase.useCase}`
							: ""}
					</div>
				</div>
				<div className="shrink-0 text-right sm:hidden">
					<div className="font-mono text-xl font-bold tabular-nums">
						{model.recommendPercent}%
					</div>
					<div className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
						recommend
					</div>
				</div>
			</div>
			<div className="mt-4 space-y-1.5 sm:mt-0">
				<ScoreMeter label="Value" value={model.avgValueScore} />
				<ScoreMeter label="Quality" value={model.avgQualityScore} />
				<ScoreMeter label="Speed" value={model.avgSpeedScore} />
			</div>
			<div className="hidden w-24 text-right sm:block">
				<div className="font-mono text-xl font-bold tabular-nums">
					{model.recommendPercent}%
				</div>
				<div className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
					recommend
				</div>
			</div>
		</div>
	);
}

export default async function CensusPage({
	params,
}: {
	params: Promise<{ year: string }>;
}) {
	const { year: rawYear } = await params;
	const year = parseYear(rawYear);
	if (!year) {
		notFound();
	}

	const results = await fetchModelSurveyResults(year);
	const models = results?.models ?? [];
	const isCurrentYear = year === new Date().getUTCFullYear();

	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "Dataset",
		name: `The ${year} DevPass Model Census`,
		description:
			"Coding LLMs rated on value for money, output quality, and speed by DevPass developers with verified usage.",
		url: `${BASE_URL}/data/${year}`,
		creator: {
			"@type": "Organization",
			name: "LLM Gateway",
			url: "https://llmgateway.io",
		},
		temporalCoverage: `${year}`,
		variableMeasured: [
			"value for money (1-5)",
			"output quality (1-5)",
			"speed (1-5)",
			"would recommend (%)",
		],
	};

	return (
		<div className="min-h-screen bg-background">
			<Header />
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>

			<main>
				{/* Hero */}
				<section className="relative overflow-hidden border-b">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_55%_at_50%_-5%,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-transparent" />
					<div className="container relative mx-auto max-w-3xl px-4 pt-16 pb-12 text-center sm:pt-20">
						<div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 font-mono text-xs font-medium uppercase tracking-[0.15em] text-emerald-600 dark:text-emerald-400">
							<ClipboardCheck className="h-3.5 w-3.5" />
							{isCurrentYear
								? `Census open · Q${Math.floor(new Date().getUTCMonth() / 3) + 1} wave filing now`
								: `Final ${year} registry`}
						</div>
						<h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
							Which coding models are actually worth the money?
						</h1>
						<p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-pretty text-muted-foreground">
							The {year} DevPass Model Census: value, quality, and speed — rated
							only by developers who shipped with these models. Every rating is
							backed by at least 50 real requests through LLM Gateway in the
							past 30 days. No benchmarks, no vibes.
						</p>
						<div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<Button size="lg" asChild>
								<Link href="/dashboard/survey">
									<Stamp className="mr-1.5 h-4 w-4" />
									File your entry · claim a free Reset Pass
								</Link>
							</Button>
							<GetDevPassButton
								cta="get_started"
								location="census_hero"
								signupHref="/signup?plan=pro"
							/>
						</div>
					</div>
				</section>

				{/* Stats */}
				{results && results.totalResponses > 0 && (
					<section className="border-b bg-muted/20 px-4 py-8">
						<div className="container mx-auto grid max-w-3xl grid-cols-3 gap-4 text-center">
							{[
								{ label: "Entries filed", value: results.totalResponses },
								{
									label: "Developers reporting",
									value: results.totalRespondents,
								},
								{
									label: "Models on the registry",
									value: results.totalModelsRated,
								},
							].map((stat) => (
								<div key={stat.label}>
									<div className="font-mono text-2xl font-bold tabular-nums sm:text-3xl">
										{stat.value.toLocaleString()}
									</div>
									<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground sm:tracking-[0.2em]">
										{stat.label}
									</div>
								</div>
							))}
						</div>
					</section>
				)}

				{/* Registry */}
				<section className="px-4 py-12">
					<div className="container mx-auto max-w-3xl">
						<div className="mb-4 flex items-baseline justify-between gap-4">
							<h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-stone-500 sm:tracking-[0.35em] dark:text-stone-400">
								The registry · ranked by value score
							</h2>
							<span className="shrink-0 font-mono text-[9px] tracking-[0.25em] whitespace-nowrap text-stone-400 dark:text-stone-500">
								Doc. CS-{year}
							</span>
						</div>
						{models.length > 0 ? (
							<div className="overflow-hidden rounded-lg border border-dashed border-stone-400/70 bg-stone-50/70 dark:border-stone-600/70 dark:bg-stone-900/30">
								{models.map((model, index) => (
									<ModelRow
										key={model.modelId}
										model={model}
										rank={index + 1}
									/>
								))}
							</div>
						) : (
							<div className="rounded-lg border border-dashed border-stone-400/70 bg-stone-50/70 p-10 text-center dark:border-stone-600/70 dark:bg-stone-900/30">
								<div className="mx-auto inline-block rounded-md border-4 border-double border-stone-400/70 px-6 py-2 font-mono uppercase text-stone-500 dark:border-stone-600 dark:text-stone-400">
									<div className="text-sm font-bold tracking-[0.3em]">
										{results ? "Registry open" : "Registry offline"}
									</div>
								</div>
								<p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
									{results
										? `Models appear here once ${results.minResponses} developers have filed verified entries on them. DevPass members: your census entry gets the registry moving — and earns you a free Reset Pass.`
										: "The registry couldn't be reached just now — the entries are safe. Check back in a few minutes."}
								</p>
							</div>
						)}
						<p className="mt-4 text-center text-xs text-muted-foreground">
							Scores are 1–5 averages. Models need {results?.minResponses ?? 5}+
							verified ratings to be listed; totals refresh every few minutes.
						</p>
					</div>
				</section>

				{/* Methodology */}
				<section className="border-t bg-muted/20 px-4 py-16">
					<div className="container mx-auto max-w-2xl">
						<h2 className="mb-6 text-center text-2xl font-bold tracking-tight sm:text-3xl">
							The rules of the registry
						</h2>
						<div className="space-y-4">
							{[
								{
									title: "Usage-verified, or it doesn't count",
									body: "You can only rate a model your DevPass workspace has hit with 50+ requests in the past 30 days. Nobody rates a model they read a thread about.",
								},
								{
									title: "Members only",
									body: "Every respondent has an active, paid DevPass plan. These are verdicts from people spending their own credits.",
								},
								{
									title: "No small-sample noise",
									body: "A model is published only after 5 or more developers rate it, and only aggregates ever leave the building.",
								},
								{
									title: "One reward per member per quarter",
									body: "The census runs in quarterly waves. Your first entry of each wave earns a free Reset Pass — rate as many models as you use, but nobody can farm passes.",
								},
							].map((rule, index) => (
								<div
									key={rule.title}
									className="flex gap-4 rounded-lg border border-dashed p-4"
								>
									<div className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">
										{String(index + 1).padStart(2, "0")}
									</div>
									<div>
										<div className="text-sm font-semibold">{rule.title}</div>
										<p className="mt-1 text-sm text-muted-foreground">
											{rule.body}
										</p>
									</div>
								</div>
							))}
						</div>
						<div className="mt-10 text-center">
							<Button size="lg" asChild>
								<Link href="/dashboard/survey">
									<Stamp className="mr-1.5 h-4 w-4" />
									Rate your models · get a free Reset Pass
								</Link>
							</Button>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
