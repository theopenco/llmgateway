import Link from "next/link";
import { notFound } from "next/navigation";

import { CompareFaq } from "@/components/compare/compare-faq";
import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import { AuthLink } from "@/components/shared/auth-link";
import { PrintReportButton } from "@/components/usage-report/print-button";
import { Button } from "@/lib/components/button";
import { fetchServerData } from "@/lib/server-api";
import {
	USAGE_REPORT_PATH,
	monthName,
	parseUsageReportYear,
	usageReportYears,
	type UsageReport,
} from "@/lib/usage-report";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";
import {
	formatCompactNumber,
	formatNumber,
} from "@llmgateway/shared/number-format";

import type { Metadata } from "next";

export const revalidate = 3600;

interface PageProps {
	params: Promise<{ year: string }>;
}

const SITE_URL = "https://llmgateway.io";

function reportTitle(year: number) {
	return `State of LLM Usage ${year}`;
}

const description =
	"An annual report built from real production traffic on LLM Gateway: the most used LLMs, model families, provider market share and the fastest-growing models, by token volume.";

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const year = parseUsageReportYear((await params).year);
	if (year === null) {
		return {};
	}
	const title = `${reportTitle(year)} — Top Models by Real Traffic`;
	const url = `${SITE_URL}${USAGE_REPORT_PATH}/${year}`;
	return {
		title,
		description,
		alternates: { canonical: url },
		openGraph: { title, description, type: "article", url },
		twitter: { card: "summary_large_image", title, description },
	};
}

const modelNames = new Map<string, string>(
	(modelDefinitions as readonly ModelDefinition[]).map((model) => [
		model.id,
		model.name ?? model.id,
	]),
);
const providerNames = new Map<string, string>(
	providerDefinitions.map((provider) => [provider.id, provider.name]),
);

function modelName(modelId: string) {
	return modelNames.get(modelId) ?? modelId;
}

// A model family is named after the lab that built it, which is usually also
// a provider in the catalogue.
function familyName(family: string) {
	return (
		providerNames.get(family) ??
		family.charAt(0).toUpperCase() + family.slice(1)
	);
}

function formatShare(sharePercent: number) {
	return `${sharePercent.toFixed(1)}%`;
}

function ShareRow({
	rank,
	label,
	href,
	value,
	sharePercent,
	maxSharePercent,
}: {
	rank: number;
	label: string;
	href?: string;
	value: string;
	sharePercent: number;
	maxSharePercent: number;
}) {
	const width =
		maxSharePercent > 0 ? (sharePercent / maxSharePercent) * 100 : 0;
	return (
		<li className="grid grid-cols-[2rem_1fr_auto] items-center gap-x-3 gap-y-1.5 py-3">
			<span className="text-sm tabular-nums text-muted-foreground">{rank}</span>
			<span className="min-w-0 truncate font-medium">
				{href ? (
					<Link href={href} className="hover:underline underline-offset-4">
						{label}
					</Link>
				) : (
					label
				)}
			</span>
			<span className="text-sm tabular-nums text-muted-foreground">
				{value} · {formatShare(sharePercent)}
			</span>
			<span
				className="col-span-2 col-start-2 h-1.5 overflow-hidden rounded-full bg-muted"
				aria-hidden="true"
			>
				<span
					className="block h-full rounded-full bg-primary"
					style={{ width: `${Math.max(width, 1)}%` }}
				/>
			</span>
		</li>
	);
}

function Section({
	id,
	title,
	lead,
	children,
}: {
	id: string;
	title: string;
	lead: string;
	children: React.ReactNode;
}) {
	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="mt-16 break-inside-avoid"
		>
			<h2
				id={`${id}-heading`}
				className="text-2xl font-bold tracking-tight md:text-3xl"
			>
				{title}
			</h2>
			<p className="mt-3 max-w-2xl text-muted-foreground">{lead}</p>
			<div className="mt-6">{children}</div>
		</section>
	);
}

function keyFindings(report: UsageReport): string[] {
	const findings: string[] = [];
	const [topModel] = report.models;
	if (topModel) {
		findings.push(
			`${modelName(topModel.modelId)} was the most used model, carrying ${formatShare(topModel.sharePercent)} of all tokens.`,
		);
	}
	const [topFamily] = report.families;
	if (topFamily) {
		findings.push(
			`${familyName(topFamily.family)} models processed ${formatShare(topFamily.sharePercent)} of token volume, more than any other lab.`,
		);
	}
	const busiest = report.months.reduce<UsageReport["months"][number] | null>(
		(best, month) =>
			!best || month.totalTokens > best.totalTokens ? month : best,
		null,
	);
	if (busiest && report.months.length > 1) {
		findings.push(
			`${monthName(busiest.month)} was the busiest month with ${formatCompactNumber(busiest.totalTokens)} tokens.`,
		);
	}
	const leaders = new Set(
		report.months.flatMap((month) =>
			month.topModelId ? [month.topModelId] : [],
		),
	);
	if (leaders.size > 1) {
		findings.push(
			`${leaders.size} different models held the monthly number-one spot.`,
		);
	}
	const [topRiser] = report.risers;
	if (topRiser) {
		findings.push(
			`${modelName(topRiser.modelId)} grew fastest, up ${formatNumber(Math.round(topRiser.growthPercent))}% over the previous period.`,
		);
	}
	return findings;
}

async function fetchReport(year: number) {
	return await fetchServerData<UsageReport>("GET", "/public/models/report", {
		params: { query: { year } },
	});
}

export default async function StateOfLlmUsagePage({ params }: PageProps) {
	const year = parseUsageReportYear((await params).year);
	if (year === null) {
		notFound();
	}
	const report = await fetchReport(year);
	if (!report || report.totals.totalTokens === 0 || !report.throughMonth) {
		notFound();
	}

	const title = reportTitle(year);
	const url = `${SITE_URL}${USAGE_REPORT_PATH}/${year}`;
	const period = report.complete
		? `January to December ${year}`
		: `January to ${monthName(report.throughMonth)} ${year}, updated as the year runs`;
	const maxMonthTokens = Math.max(
		...report.months.map((month) => month.totalTokens),
	);
	const findings = keyFindings(report);
	// Link only to years that have a report to show.
	const otherReports = await Promise.all(
		usageReportYears()
			.filter((other) => other !== year)
			.map(fetchReport),
	);
	const otherYears = otherReports.flatMap((other) =>
		other && other.totals.totalTokens > 0 ? [other.year] : [],
	);

	const stats = [
		{
			label: "Tokens processed",
			value: formatCompactNumber(report.totals.totalTokens),
		},
		{
			label: "Requests",
			value: formatCompactNumber(report.totals.totalRequests),
		},
		{
			label: "Models with traffic",
			value: formatNumber(report.totals.activeModels),
		},
		{
			label: "Providers serving them",
			value: formatNumber(report.totals.activeProviders),
		},
	];

	const faqs = [
		{
			question: "Where does the data come from?",
			answer:
				"Every figure is aggregated from requests routed through LLM Gateway during the calendar year, in UTC. Nothing is surveyed or estimated.",
		},
		{
			question: "What does token share mean?",
			answer:
				"A model's share is its token volume divided by the tokens of all public catalogue models in the period. Provider share uses the tokens each provider served.",
		},
		{
			question: "Is any customer data in the report?",
			answer:
				"No. The report contains only totals per model and provider. Prompts, completions, organizations and privately configured models are never included.",
		},
		{
			question: "How is the fastest-growing list calculated?",
			answer:
				"It compares each model's tokens in the most recent months of the period with the same number of months before them, and ignores models with a marginal share of traffic.",
		},
		{
			question: "Can I cite or reuse these numbers?",
			answer:
				"Yes. Link to this page as the source. For live weekly numbers, use the LLM rankings.",
		},
	];

	const structuredData = [
		{
			"@context": "https://schema.org",
			"@type": "BreadcrumbList",
			itemListElement: [
				{ "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
				{ "@type": "ListItem", position: 2, name: title, item: url },
			],
		},
		{
			"@context": "https://schema.org",
			"@type": "Report",
			headline: title,
			description,
			url,
			about: "Large language model usage",
			temporalCoverage: String(year),
			publisher: {
				"@type": "Organization",
				name: "LLM Gateway",
				url: SITE_URL,
			},
		},
		{
			"@context": "https://schema.org",
			"@type": "ItemList",
			name: `Most used LLMs of ${year}`,
			itemListOrder: "https://schema.org/ItemListOrderDescending",
			numberOfItems: report.models.length,
			itemListElement: report.models.map((model, index) => ({
				"@type": "ListItem",
				position: index + 1,
				name: modelName(model.modelId),
				url: `${SITE_URL}/models/${encodeURIComponent(model.modelId)}`,
			})),
		},
	];

	return (
		<>
			<JsonLd data={structuredData} />
			<div className="print:hidden">
				<Navbar />
			</div>
			<div className="min-h-screen bg-background pt-24 pb-16 md:pt-32 print:pt-0">
				<div className="container mx-auto max-w-5xl px-4 py-8">
					<header>
						<p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Annual report · {period}
						</p>
						<h1 className="text-4xl font-bold tracking-tight text-balance md:text-6xl">
							{title}
						</h1>
						<p className="mt-5 max-w-2xl text-muted-foreground md:text-lg">
							Which models, labs and providers carried production traffic this
							year. Measured from real token volume routed through LLM Gateway,
							not from benchmarks or surveys.
						</p>
						<div className="mt-6 flex flex-wrap items-center gap-3">
							<PrintReportButton />
							<Button asChild variant="ghost" className="print:hidden">
								<Link href="/rankings">See live rankings</Link>
							</Button>
						</div>
					</header>

					<dl className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-4">
						{stats.map((stat) => (
							<div key={stat.label} className="bg-background p-5">
								<dt className="text-sm text-muted-foreground">{stat.label}</dt>
								<dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
									{stat.value}
								</dd>
							</div>
						))}
					</dl>

					{findings.length > 0 ? (
						<Section
							id="findings"
							title="Key findings"
							lead={`The short version of ${year}.`}
						>
							<ul className="grid gap-3 md:grid-cols-2">
								{findings.map((finding) => (
									<li
										key={finding}
										className="rounded-xl border bg-card p-5 text-card-foreground"
									>
										{finding}
									</li>
								))}
							</ul>
						</Section>
					) : null}

					<Section
						id="volume"
						title="Token volume by month"
						lead="Total tokens processed each month, with the model that led it."
					>
						<ol className="space-y-2">
							{report.months.map((month) => (
								<li
									key={month.month}
									className="grid grid-cols-[5.5rem_1fr] items-center gap-3 md:grid-cols-[5.5rem_1fr_14rem]"
								>
									<span className="text-sm text-muted-foreground">
										{monthName(month.month)}
									</span>
									<span className="flex items-center gap-3">
										<span
											className="h-6 rounded bg-primary"
											style={{
												width: `${Math.max((month.totalTokens / maxMonthTokens) * 100, 1)}%`,
											}}
											aria-hidden="true"
										/>
										<span className="shrink-0 text-sm font-medium tabular-nums">
											{formatCompactNumber(month.totalTokens)}
										</span>
									</span>
									<span className="col-start-2 truncate text-sm text-muted-foreground md:col-start-3">
										{month.topModelId
											? `Led by ${modelName(month.topModelId)}`
											: null}
									</span>
								</li>
							))}
						</ol>
					</Section>

					<Section
						id="models"
						title={`Most used LLMs of ${year}`}
						lead="Ranked by tokens across every provider that serves the model."
					>
						<ol className="divide-y">
							{report.models.map((model, index) => (
								<ShareRow
									key={model.modelId}
									rank={index + 1}
									label={modelName(model.modelId)}
									href={`/models/${encodeURIComponent(model.modelId)}`}
									value={formatCompactNumber(model.totalTokens)}
									sharePercent={model.sharePercent}
									maxSharePercent={report.models[0].sharePercent}
								/>
							))}
						</ol>
					</Section>

					<div className="grid gap-x-12 md:grid-cols-2">
						<Section
							id="families"
							title="Share by model lab"
							lead="Token volume grouped by the lab that built the model."
						>
							<ol className="divide-y">
								{report.families.map((family, index) => (
									<ShareRow
										key={family.family}
										rank={index + 1}
										label={familyName(family.family)}
										value={formatCompactNumber(family.totalTokens)}
										sharePercent={family.sharePercent}
										maxSharePercent={report.families[0].sharePercent}
									/>
								))}
							</ol>
						</Section>

						<Section
							id="providers"
							title="Provider market share"
							lead="Who actually served the tokens, including third-party hosts."
						>
							<ol className="divide-y">
								{report.providers.slice(0, 10).map((provider, index) => (
									<ShareRow
										key={provider.providerId}
										rank={index + 1}
										label={
											providerNames.get(provider.providerId) ??
											provider.providerId
										}
										href={`/providers/${encodeURIComponent(provider.providerId)}`}
										value={formatCompactNumber(provider.totalTokens)}
										sharePercent={provider.sharePercent}
										maxSharePercent={report.providers[0].sharePercent}
									/>
								))}
							</ol>
						</Section>
					</div>

					{report.risers.length > 0 ? (
						<Section
							id="risers"
							title="Fastest-growing models"
							lead="Growth in token volume over the most recent months of the period, against the months before them."
						>
							<ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
								{report.risers.map((riser) => (
									<li key={riser.modelId} className="rounded-xl border p-5">
										<p className="text-2xl font-semibold tabular-nums text-green-600 dark:text-green-400">
											+{formatNumber(Math.round(riser.growthPercent))}%
										</p>
										<Link
											href={`/models/${encodeURIComponent(riser.modelId)}`}
											className="mt-1 block font-medium hover:underline underline-offset-4"
										>
											{modelName(riser.modelId)}
										</Link>
										<p className="mt-1 text-sm text-muted-foreground">
											{formatCompactNumber(riser.previousTokens)} to{" "}
											{formatCompactNumber(riser.recentTokens)} tokens
										</p>
									</li>
								))}
							</ol>
						</Section>
					) : null}

					<Section
						id="method"
						title="Methodology"
						lead="How to read the numbers."
					>
						<div className="max-w-3xl space-y-4 text-muted-foreground">
							<p>
								The report counts tokens and requests routed through LLM Gateway
								in {year}, in UTC, for models in the public catalogue. A model
								served by several providers is counted once in the model ranking
								and split by host in the provider ranking.
							</p>
							<p>
								Usage shows where production workloads run. It is not a quality
								score: a model can top a benchmark and still see little real
								traffic. Gateway traffic also leans towards developers who route
								across providers, so read shares as a view of that audience
								rather than of the whole market.
							</p>
						</div>
					</Section>

					<section className="mt-16 rounded-2xl border bg-card p-8 text-card-foreground print:hidden">
						<h2 className="text-2xl font-bold tracking-tight">
							Run every model in this report through one API
						</h2>
						<p className="mt-2 max-w-2xl text-muted-foreground">
							One OpenAI-compatible endpoint, one key, automatic failover
							between providers.
						</p>
						<div className="mt-5 flex flex-wrap gap-3">
							<Button asChild>
								<AuthLink href="/signup">Start for free</AuthLink>
							</Button>
							<Button asChild variant="outline">
								<Link href="/models">Browse models</Link>
							</Button>
						</div>
						{otherYears.length > 0 ? (
							<p className="mt-6 text-sm text-muted-foreground">
								Other years:{" "}
								{otherYears.map((other, index) => (
									<span key={other}>
										{index > 0 ? ", " : null}
										<Link
											href={`${USAGE_REPORT_PATH}/${other}`}
											className="underline underline-offset-4"
										>
											{other}
										</Link>
									</span>
								))}
							</p>
						) : null}
					</section>
				</div>
				<div className="print:hidden">
					<CompareFaq heading="About this report" faqs={faqs} />
				</div>
			</div>
			<div className="print:hidden">
				<Footer />
			</div>
		</>
	);
}
