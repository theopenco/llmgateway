import { ShieldCheck, Stamp } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Footer } from "@/components/Footer";
import { GetDevPassButton } from "@/components/GetDevPassButton";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { getConfig } from "@/lib/config-server";
import { FIRST_SURVEY_YEAR, fetchModelSurveyResults } from "@/lib/model-survey";

import { models as catalogueModels, providers } from "@llmgateway/models";

import {
	BoardingPass,
	PassportDataPage,
	VendorMark,
	VisaStamp,
} from "./census-components";
import { formatScore, parseCensusQuery } from "./census-shared";
import { CensusRegistry } from "./CensusRegistry";

import type { CensusModel } from "./census-shared";
import type { ModelSurveyModel } from "@/lib/model-survey";
import type { Metadata } from "next";
import type { ReactNode } from "react";

const BASE_URL = "https://devpass.llmgateway.io";

export const revalidate = 300;

// Display names for catalogue families whose provider name reads awkwardly
// in a vendor chip, plus families that have no provider entry at all.
const FAMILY_LABELS: Record<string, string> = {
	google: "Google",
	zai: "Z.ai",
	alibaba: "Alibaba",
	moonshot: "Moonshot",
	mistral: "Mistral",
	nvidia: "NVIDIA",
	tencent: "Tencent",
	inclusionai: "inclusionAI",
	nousresearch: "Nous Research",
	openbmb: "OpenBMB",
	baai: "BAAI",
	other: "Other",
};

const ID_FAMILY_HINTS: [RegExp, string][] = [
	[/^(gpt|o\d|codex)/, "openai"],
	[/^claude/, "anthropic"],
	[/^gemini|^gemma/, "google"],
	[/^deepseek/, "deepseek"],
	[/^glm/, "zai"],
	[/^qwen|^qwq/, "alibaba"],
	[/^kimi|^moonshot/, "moonshot"],
	[/^grok/, "xai"],
	[/^(mistral|codestral|devstral|magistral)/, "mistral"],
	[/^minimax/, "minimax"],
	[/^llama/, "meta"],
];

type CatalogueModel = (typeof catalogueModels)[number];

const catalogueById = new Map<string, CatalogueModel>(
	catalogueModels.map((model): [string, CatalogueModel] => [model.id, model]),
);

function inferFamily(modelId: string): string {
	const hit = ID_FAMILY_HINTS.find(([pattern]) => pattern.test(modelId));
	return hit ? hit[1] : "other";
}

function vendorLabel(family: string): string {
	return (
		FAMILY_LABELS[family] ??
		providers.find((provider) => provider.id === family)?.name ??
		family.charAt(0).toUpperCase() + family.slice(1)
	);
}

function enrichModels(models: ModelSurveyModel[]): CensusModel[] {
	return models.map((model, index) => {
		const definition = catalogueById.get(model.modelId);
		const vendorId = definition?.family ?? inferFamily(model.modelId);
		return {
			...model,
			rank: index + 1,
			name: definition?.name ?? model.modelId,
			vendorId,
			vendorName: vendorLabel(vendorId),
			topUseCase: model.useCases[0]?.useCase ?? null,
		};
	});
}

function leader(
	models: CensusModel[],
	score: (model: CensusModel) => number,
): CensusModel | null {
	let best: CensusModel | null = null;
	for (const model of models) {
		if (
			!best ||
			score(model) > score(best) ||
			(score(model) === score(best) && model.responseCount > best.responseCount)
		) {
			best = model;
		}
	}
	return best;
}

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
	const title = `${year} DevPass Model Census: Coding Models Rated by Developers`;
	const description = `Coding models rated on value, quality, and speed by DevPass developers with verified usage. Sort and filter the ${year} registry by vendor, use case, and ratings.`;
	return {
		title: { absolute: title },
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

const RULES = [
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
];

function buildFaq(year: number, minResponses: number) {
	return [
		{
			question: "How are models scored in the DevPass Model Census?",
			answer: `Each entry rates one model from 1 to 5 on value for money, output quality, and speed, plus a yes-or-no “would you recommend it”. The registry shows the per-model averages and the share of raters who would recommend the model.`,
		},
		{
			question: "Who can rate a model?",
			answer:
				"Only paid DevPass members, and only for models their workspace has sent at least 50 requests to in the past 30 days. Ratings are tied to verified usage, not opinions from a thread.",
		},
		{
			question: "How is the registry ranked?",
			answer:
				"Registry rank is the model's position by average value score, with ties broken by number of ratings. The sort and filter controls change what you see on the board but never the underlying rank.",
		},
		{
			question: "Why is a model missing from the registry?",
			answer: `A model appears once ${minResponses} or more developers have filed a verified rating on it in ${year}. Per-use-case breakdowns are additionally hidden below two entries so no single respondent can be identified.`,
		},
		{
			question: "How often does the census update?",
			answer:
				"Members file entries in quarterly waves and the yearly registry aggregates every wave. The published totals refresh every five minutes.",
		},
	];
}

function SectionHeading({
	id,
	eyebrow,
	title,
	aside,
}: {
	id: string;
	eyebrow: string;
	title: string;
	aside?: ReactNode;
}) {
	return (
		<div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
			<div>
				<p className="font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-700 dark:text-emerald-400">
					{eyebrow}
				</p>
				<h2
					id={id}
					className="font-display mt-2 text-3xl font-bold tracking-tight text-balance sm:text-4xl"
				>
					{title}
				</h2>
			</div>
			{aside ? (
				<p className="max-w-md text-sm text-muted-foreground">{aside}</p>
			) : null}
		</div>
	);
}

export default async function CensusPage({
	params,
	searchParams,
}: {
	params: Promise<{ year: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const [{ year: rawYear }, rawSearchParams] = await Promise.all([
		params,
		searchParams,
	]);
	const year = parseYear(rawYear);
	if (!year) {
		notFound();
	}

	const results = await fetchModelSurveyResults(year);
	const models = enrichModels(results?.models ?? []);
	const minResponses = results?.minResponses ?? 5;
	const now = new Date();
	const isCurrentYear = year === now.getUTCFullYear();
	const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
	const initialQuery = parseCensusQuery(rawSearchParams);
	const modelHrefBase = getConfig().uiUrl;

	const vendorCounts = new Map<string, { name: string; count: number }>();
	for (const model of models) {
		const entry = vendorCounts.get(model.vendorId);
		if (entry) {
			entry.count += 1;
		} else {
			vendorCounts.set(model.vendorId, { name: model.vendorName, count: 1 });
		}
	}
	const vendors = Array.from(vendorCounts, ([id, entry]) => ({
		id,
		name: entry.name,
		count: entry.count,
	})).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	const vendorMarks = Object.fromEntries(
		vendors.map((vendor) => [
			vendor.id,
			<VendorMark
				key={vendor.id}
				vendorId={vendor.id}
				vendorName={vendor.name}
			/>,
		]),
	);

	const bestValue = leader(models, (m) => m.avgValueScore);
	const bestQuality = leader(models, (m) => m.avgQualityScore);
	const fastest = leader(models, (m) => m.avgSpeedScore);
	const mostRated = leader(models, (m) => m.responseCount);
	const champions =
		bestValue && bestQuality && fastest
			? [
					{
						title: "Best value",
						code: "Value",
						model: bestValue,
						score: bestValue.avgValueScore,
						scoreLabel: "Value",
					},
					{
						title: "Best quality",
						code: "Quality",
						model: bestQuality,
						score: bestQuality.avgQualityScore,
						scoreLabel: "Quality",
					},
					{
						title: "Fastest",
						code: "Speed",
						model: fastest,
						score: fastest.avgSpeedScore,
						scoreLabel: "Speed",
					},
				]
			: [];

	const asOf = now.toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
	const summary =
		results && bestValue && bestQuality && fastest && mostRated
			? `As of ${asOf}, ${bestValue.name} leads the ${year} DevPass Model Census on value for money (${formatScore(bestValue.avgValueScore)}/5 across ${bestValue.responseCount} verified ratings), ${bestQuality.name} leads on output quality (${formatScore(bestQuality.avgQualityScore)}/5), and ${fastest.name} leads on speed (${formatScore(fastest.avgSpeedScore)}/5). ${results.totalRespondents.toLocaleString("en-US")} DevPass developers have filed ${results.totalResponses.toLocaleString("en-US")} verified ratings across ${results.totalModelsRated} models. The most-rated model is ${mostRated.name} with ${mostRated.responseCount} ratings and a ${mostRated.recommendPercent}% recommend rate.`
			: null;

	const faq = buildFaq(year, minResponses);
	const pageUrl = `${BASE_URL}/data/${year}`;
	const jsonLd = {
		"@context": "https://schema.org",
		"@graph": [
			{
				"@type": "Dataset",
				"@id": `${pageUrl}#dataset`,
				name: `The ${year} DevPass Model Census`,
				description:
					"Coding LLMs rated on value for money, output quality, and speed by DevPass developers with verified usage.",
				url: pageUrl,
				creator: {
					"@type": "Organization",
					name: "LLM Gateway",
					url: "https://llmgateway.io",
				},
				license: "https://llmgateway.io/legal/terms",
				isAccessibleForFree: true,
				temporalCoverage: `${year}`,
				dateModified: now.toISOString().slice(0, 10),
				keywords: [
					"coding models",
					"LLM ratings",
					"developer survey",
					"AI coding assistants",
					"DevPass",
				],
				measurementTechnique:
					"Self-reported 1–5 ratings from paid DevPass members with at least 50 requests on the rated model in the prior 30 days; models published at 5+ ratings.",
				variableMeasured: [
					"value for money (1-5)",
					"output quality (1-5)",
					"speed (1-5)",
					"would recommend (%)",
				],
			},
			...(models.length > 0
				? [
						{
							"@type": "ItemList",
							"@id": `${pageUrl}#registry`,
							name: `${year} DevPass Model Census registry, ranked by value score`,
							itemListOrder: "https://schema.org/ItemListOrderDescending",
							numberOfItems: models.length,
							itemListElement: models.map((model) => ({
								"@type": "ListItem",
								position: model.rank,
								name: model.name,
								description: `${model.vendorName} · value ${formatScore(model.avgValueScore)}/5, quality ${formatScore(model.avgQualityScore)}/5, speed ${formatScore(model.avgSpeedScore)}/5, ${model.recommendPercent}% would recommend, ${model.responseCount} verified ratings`,
							})),
						},
					]
				: []),
			{
				"@type": "FAQPage",
				"@id": `${pageUrl}#faq`,
				mainEntity: faq.map((item) => ({
					"@type": "Question",
					name: item.question,
					acceptedAnswer: { "@type": "Answer", text: item.answer },
				})),
			},
			{
				"@type": "BreadcrumbList",
				itemListElement: [
					{
						"@type": "ListItem",
						position: 1,
						name: "DevPass",
						item: BASE_URL,
					},
					{
						"@type": "ListItem",
						position: 2,
						name: `${year} Model Census`,
						item: pageUrl,
					},
				],
			},
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

			<main id="main">
				{/* Hero */}
				<section
					aria-labelledby="census-title"
					className="census-guilloche relative overflow-hidden border-b"
				>
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_20%_-10%,_var(--tw-gradient-stops))] from-emerald-500/15 via-transparent to-transparent" />
					<div className="container relative mx-auto grid max-w-6xl gap-10 px-4 pt-14 pb-14 lg:grid-cols-12 lg:items-center lg:pt-20 lg:pb-20">
						<div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-both lg:col-span-7">
							<p className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-700 dark:text-emerald-400">
								<ShieldCheck aria-hidden="true" className="h-4 w-4" />
								The {year} DevPass Model Census
							</p>
							<h1
								id="census-title"
								className="font-display mt-4 text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl"
							>
								Which coding models are actually worth the money?
							</h1>
							<p className="mt-5 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
								The {year} DevPass Model Census rates coding models on value,
								quality, and speed — using only developers who shipped with
								them. Every rating is backed by at least 50 real requests
								through LLM Gateway in the past 30 days. No benchmarks, no
								vibes.
							</p>
							<div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
								<Button size="lg" asChild>
									<Link href="/dashboard/survey">
										<Stamp aria-hidden="true" className="mr-1.5 h-4 w-4" />
										File your entry · claim a free Reset Pass
									</Link>
								</Button>
								<GetDevPassButton
									cta="get_started"
									location="census_hero"
									signupHref="/signup?plan=pro"
								/>
							</div>
							<ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-stone-600 dark:text-stone-400">
								<li>✓ 50+ requests per rating</li>
								<li>✓ Paid members only</li>
								<li>✓ Aggregates, never individuals</li>
							</ul>
						</div>
						<div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:delay-150 lg:col-span-5">
							{results ? (
								<PassportDataPage
									year={year}
									results={results}
									isCurrentYear={isCurrentYear}
									quarter={quarter}
								/>
							) : (
								<div className="census-paper rounded-2xl border border-stone-300/90 p-8 text-center dark:border-stone-700">
									<VisaStamp tone="stone" rotate={-4} sub="Entries are safe">
										Registry offline
									</VisaStamp>
									<p className="mx-auto mt-5 max-w-sm text-sm text-muted-foreground">
										The registry couldn&apos;t be reached just now. Check back
										in a few minutes.
									</p>
								</div>
							)}
						</div>
					</div>
				</section>

				{/* Category leaders */}
				{champions.length > 0 && (
					<section aria-labelledby="leaders-title" className="px-4 py-14">
						<div className="container mx-auto max-w-6xl">
							<SectionHeading
								id="leaders-title"
								eyebrow="Now boarding · category leaders"
								title="Top of the registry"
								aside={`Highest average in each score across every model with ${minResponses}+ verified ratings. Ties go to the model with more ratings.`}
							/>
							<div className="grid gap-5 md:grid-cols-3">
								{champions.map((champion, index) => {
									const stagger = index * 90;
									return (
										<BoardingPass
											key={champion.title}
											title={champion.title}
											code={champion.code}
											model={champion.model}
											score={champion.score}
											scoreLabel={champion.scoreLabel}
											year={year}
											delayMs={120 + stagger}
										/>
									);
								})}
							</div>
							{summary && (
								<p
									id="census-summary"
									className="mt-8 max-w-4xl text-sm leading-relaxed text-muted-foreground"
								>
									{summary}
								</p>
							)}
						</div>
					</section>
				)}

				{/* Registry */}
				<section
					aria-labelledby="registry-title"
					className="border-t bg-muted/20 px-4 py-14"
				>
					<div className="container mx-auto max-w-6xl">
						<SectionHeading
							id="registry-title"
							eyebrow="Departures · full registry"
							title="Every model on the registry"
							aside="Click a column to sort, or narrow the board by vendor, use case, and rating count. Filters live in the URL, so a view can be shared."
						/>
						{models.length > 0 ? (
							<CensusRegistry
								year={year}
								models={models}
								vendors={vendors.map(({ id, name }) => ({ id, name }))}
								vendorMarks={vendorMarks}
								initialQuery={initialQuery}
								minResponses={minResponses}
								modelHrefBase={modelHrefBase}
							/>
						) : (
							<div className="census-paper rounded-2xl border border-stone-300/90 p-10 text-center dark:border-stone-700">
								<VisaStamp tone={results ? "emerald" : "stone"} rotate={-4}>
									{results ? "Registry open" : "Registry offline"}
								</VisaStamp>
								<p className="mx-auto mt-5 max-w-md text-sm text-muted-foreground">
									{results
										? `Models appear here once ${minResponses} developers have filed verified entries on them. DevPass members: your census entry gets the registry moving — and earns you a free Reset Pass.`
										: "The registry couldn't be reached just now — the entries are safe. Check back in a few minutes."}
								</p>
							</div>
						)}
						<p className="mt-4 text-center text-xs text-muted-foreground">
							Scores are 1–5 averages. Models need {minResponses}+ verified
							ratings to be listed; totals refresh every few minutes. Last
							updated {asOf} (UTC).
						</p>
					</div>
				</section>

				{/* Rules + FAQ */}
				<section aria-labelledby="rules-title" className="border-t px-4 py-16">
					<div className="container mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:gap-16">
						<div>
							<p className="font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-700 dark:text-emerald-400">
								Conditions of entry
							</p>
							<h2
								id="rules-title"
								className="font-display mt-2 text-3xl font-bold tracking-tight text-balance sm:text-4xl"
							>
								The rules of the registry
							</h2>
							<ol className="mt-8 space-y-4">
								{RULES.map((rule, index) => (
									<li
										key={rule.title}
										className="census-paper flex gap-4 rounded-xl border border-stone-300/90 p-5 dark:border-stone-700"
									>
										<span
											aria-hidden="true"
											className="flex h-10 w-10 shrink-0 -rotate-6 items-center justify-center rounded-full border-[3px] border-double border-emerald-700/70 font-mono text-sm font-bold text-emerald-800 mix-blend-multiply dark:border-emerald-400/60 dark:text-emerald-300 dark:mix-blend-screen"
										>
											{String(index + 1).padStart(2, "0")}
										</span>
										<div>
											<h3 className="text-base font-semibold">{rule.title}</h3>
											<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
												{rule.body}
											</p>
										</div>
									</li>
								))}
							</ol>
						</div>
						<div>
							<p className="font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-700 dark:text-emerald-400">
								Reading the census
							</p>
							<h2
								id="faq-title"
								className="font-display mt-2 text-3xl font-bold tracking-tight text-balance sm:text-4xl"
							>
								Model Census FAQ
							</h2>
							<dl className="mt-8 divide-y divide-dashed divide-stone-300 dark:divide-stone-700">
								{faq.map((item) => (
									<div key={item.question} className="py-5 first:pt-0">
										<dt className="text-base font-semibold">{item.question}</dt>
										<dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
											{item.answer}
										</dd>
									</div>
								))}
							</dl>
						</div>
					</div>
				</section>

				{/* CTA */}
				<section
					aria-labelledby="cta-title"
					className="census-paper border-t px-4 py-16"
				>
					<div className="container mx-auto max-w-3xl text-center">
						<VisaStamp rotate={-5} sub={`Wave Q${quarter} · ${year}`}>
							Your entry
						</VisaStamp>
						<h2
							id="cta-title"
							className="font-display mt-6 text-3xl font-bold tracking-tight text-balance sm:text-4xl"
						>
							Rate the models you ship with, stamp a free Reset Pass
						</h2>
						<p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
							Takes two minutes. Your first entry of the wave earns a Reset Pass
							on your tier, and every entry sharpens the registry for the next
							developer at the desk.
						</p>
						<div className="mt-8">
							<Button size="lg" asChild>
								<Link href="/dashboard/survey">
									<Stamp aria-hidden="true" className="mr-1.5 h-4 w-4" />
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
