import { ArrowLeft, ArrowUpRight, Shuffle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import {
	IndicatorDot,
	StatusHistoryBar,
	StatusLegend,
} from "@/components/status/status-history-bar";
import { pageTitle } from "@/lib/page-title";
import { hasEnoughRequestsForStats } from "@/lib/provider-stats";
import {
	fetchProviderStatus,
	findStatusProvider,
	formatIncidentDuration,
	formatUptime,
	incidentImpactByDay,
	indicatorLabels,
	statusProviders,
	uptimeTextClass,
	type OfficialIncident,
	type ProviderStatusDetail,
} from "@/lib/provider-status";
import { cn } from "@/lib/utils";

import {
	models as modelDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";
import {
	isMappingDeactivated,
	providerLogoUrls,
} from "@llmgateway/shared/components";
import { formatNumber } from "@llmgateway/shared/number-format";

import type { Metadata } from "next";

export const revalidate = 300;
export const dynamicParams = false;

interface PageProps {
	params: Promise<{ provider: string }>;
}

const MAX_FAILOVER_MODELS = 12;
const VISIBLE_INCIDENTS = 8;

const incidentDateFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	timeZone: "UTC",
	timeZoneName: "short",
});

function failoverModels(providerId: string) {
	return (modelDefinitions as readonly ModelDefinition[])
		.filter((model) =>
			model.providers.some(
				(mapping) =>
					mapping.providerId === providerId && !isMappingDeactivated(mapping),
			),
		)
		.map((model) => ({
			id: model.id,
			name: model.name ?? model.id,
			alternatives: new Set(
				model.providers
					.filter(
						(mapping) =>
							mapping.providerId !== providerId &&
							!isMappingDeactivated(mapping),
					)
					.map((mapping) => mapping.providerId),
			).size,
		}));
}

function IncidentItem({ incident }: { incident: OfficialIncident }) {
	const duration = formatIncidentDuration(incident);
	return (
		<li className="rounded-lg border border-border/60 p-4">
			<a
				href={incident.url}
				target="_blank"
				rel="noopener noreferrer"
				className="group flex items-start justify-between gap-4"
			>
				<span className="font-medium group-hover:underline">
					{incident.name}
				</span>
				<ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
			</a>
			<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
				<span className="inline-flex items-center gap-1.5">
					<IndicatorDot indicator={incident.impact} className="h-2 w-2" />
					{incident.impact === "none"
						? "No impact"
						: indicatorLabels[incident.impact]}
				</span>
				<span>{incidentDateFormat.format(new Date(incident.createdAt))}</span>
				<span className="capitalize">
					{incident.status.replaceAll("_", " ")}
				</span>
				{duration ? <span>{duration}</span> : null}
			</div>
		</li>
	);
}

function MeasuredStat({
	label,
	measured,
}: {
	label: string;
	measured: ProviderStatusDetail["measured"]["last24h"] | undefined;
}) {
	const enough =
		measured !== undefined &&
		measured.uptime !== null &&
		hasEnoughRequestsForStats(measured.requestCount);
	return (
		<div className="rounded-lg border border-border/60 p-4">
			<div className="text-xs uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div
				className={cn(
					"mt-1 text-2xl font-semibold tabular-nums",
					enough && measured.uptime !== null
						? uptimeTextClass(measured.uptime)
						: "text-muted-foreground",
				)}
			>
				{enough && measured.uptime !== null
					? formatUptime(measured.uptime)
					: "—"}
			</div>
			<div className="mt-1 text-xs text-muted-foreground">
				{enough
					? `${formatNumber(measured.requestCount)} requests`
					: "Not enough traffic"}
			</div>
		</div>
	);
}

export default async function ProviderStatusPage({ params }: PageProps) {
	const { provider: providerId } = await params;
	const provider = findStatusProvider(providerId);
	if (!provider) {
		notFound();
	}

	const status = await fetchProviderStatus(provider.id);
	const official = status?.official ?? null;
	const officialState = status?.officialState ?? "unavailable";
	const statusPageUrl = provider.statusPageUrl ?? null;
	const incidents = official?.incidents ?? [];
	const incidentsByDay = incidentImpactByDay(incidents);
	const models = failoverModels(provider.id);
	const withFailover = models.filter((model) => model.alternatives > 0);
	const shownModels = [...withFailover]
		.sort((a, b) => b.alternatives - a.alternatives)
		.slice(0, MAX_FAILOVER_MODELS);
	const Logo = providerLogoUrls[provider.id];
	const pageUrl = `https://llmgateway.io/status/${provider.id}`;

	const faqs = [
		{
			question: `Is ${provider.name} down right now?`,
			answer: official
				? `${provider.name}'s official status page currently reports: ${official.description}. This page also shows the success rate LLM Gateway measured on real ${provider.name} traffic over the last 24 hours.`
				: officialState === "unsupported"
					? `${provider.name} does not publish a machine-readable status feed. This page shows the success rate LLM Gateway measured on real ${provider.name} traffic over the last 24 hours and 90 days.`
					: `${provider.name}'s official status page could not be reached just now. This page shows the success rate LLM Gateway measured on real ${provider.name} traffic over the last 24 hours and 90 days.`,
		},
		{
			question: `How is ${provider.name} uptime measured?`,
			answer: `Uptime is the share of requests to ${provider.name} through LLM Gateway that completed without a provider or gateway error. Invalid requests (4xx caused by the request) and traffic on customers' own provider keys are excluded.`,
		},
		{
			question: `What happens to my requests when ${provider.name} has an outage?`,
			answer:
				withFailover.length > 0
					? `LLM Gateway retries failed requests on another healthy provider serving the same model and routes new traffic away from degraded providers. ${withFailover.length} of the ${models.length} ${provider.name} models on LLM Gateway can fail over this way.`
					: `LLM Gateway routes new traffic away from degraded providers. The ${provider.name} models on LLM Gateway are currently served only by ${provider.name}, so they cannot fail over to another provider.`,
		},
		{
			question: "How often does this page update?",
			answer:
				"Every five minutes. Measured uptime comes from LLM Gateway's hourly traffic rollups; the official status and incidents come from the provider's status page.",
		},
	];

	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{
				"@type": "ListItem",
				position: 1,
				name: "Home",
				item: "https://llmgateway.io",
			},
			{
				"@type": "ListItem",
				position: 2,
				name: "Status",
				item: "https://llmgateway.io/status",
			},
			{
				"@type": "ListItem",
				position: 3,
				name: provider.name,
				item: pageUrl,
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
			<JsonLd data={[breadcrumbSchema, faqSchema]} />
			<Navbar />
			<main className="min-h-screen bg-background pb-16 pt-24 md:pt-32">
				<div className="container mx-auto max-w-5xl px-4 py-8">
					<Link
						href="/status"
						className="mb-6 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
					>
						<ArrowLeft className="mr-2 h-4 w-4" />
						All provider status
					</Link>

					<header className="mb-8 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
						<div className="flex items-start gap-4">
							{Logo ? (
								<Logo className="h-12 w-12 shrink-0 object-contain" />
							) : null}
							<div>
								<h1 className="text-3xl font-bold tracking-tight md:text-4xl">
									{provider.name} status
								</h1>
								<p className="mt-2 max-w-2xl text-muted-foreground">
									Is {provider.name} down? Live official status, incidents, and
									the uptime LLM Gateway measured on real {provider.name}{" "}
									traffic.
								</p>
							</div>
						</div>
						<div className="flex items-center gap-2 rounded-lg border border-border/60 px-4 py-3">
							<IndicatorDot indicator={official?.indicator ?? null} />
							<span className="font-medium">
								{official
									? official.description
									: officialState === "unsupported"
										? "No official feed"
										: "Official status unavailable"}
							</span>
						</div>
					</header>

					<section className="mb-10" aria-labelledby="measured-heading">
						<div className="mb-4 flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
							<div>
								<h2 id="measured-heading" className="text-xl font-semibold">
									Measured uptime
								</h2>
								<p className="text-sm text-muted-foreground">
									Success rate of {provider.name} requests through LLM Gateway,
									by UTC day.
								</p>
							</div>
						</div>
						<div className="mb-6 grid grid-cols-2 gap-3">
							<MeasuredStat
								label="Last 24 hours"
								measured={status?.measured.last24h}
							/>
							<MeasuredStat
								label="Last 90 days"
								measured={status?.measured.last90d}
							/>
						</div>
						{status ? (
							<div className="space-y-4">
								<StatusHistoryBar
									days={status.measured.days}
									incidentsByDay={incidentsByDay}
								/>
								<StatusLegend />
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								Measured uptime is temporarily unavailable.
							</p>
						)}
					</section>

					{official && official.components.length > 0 ? (
						<section className="mb-10" aria-labelledby="components-heading">
							<h2
								id="components-heading"
								className="mb-4 text-xl font-semibold"
							>
								Official components
							</h2>
							<ul className="divide-y divide-border/60 rounded-lg border border-border/60">
								{official.components.map((component) => (
									<li
										key={component.name}
										className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
									>
										<span>{component.name}</span>
										<span className="capitalize text-muted-foreground">
											{component.status.replaceAll("_", " ")}
										</span>
									</li>
								))}
							</ul>
						</section>
					) : null}

					{official ? (
						<section className="mb-10" aria-labelledby="incidents-heading">
							<h2 id="incidents-heading" className="mb-4 text-xl font-semibold">
								Incidents in the last 90 days
							</h2>
							{incidents.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									{provider.name} reported no incidents in the last 90 days.
								</p>
							) : (
								<>
									<ul className="space-y-3">
										{incidents.slice(0, VISIBLE_INCIDENTS).map((incident) => (
											<IncidentItem key={incident.id} incident={incident} />
										))}
									</ul>
									{incidents.length > VISIBLE_INCIDENTS ? (
										<details className="group mt-3">
											<summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
												Show {incidents.length - VISIBLE_INCIDENTS} older
												incidents
											</summary>
											<ul className="mt-3 space-y-3">
												{incidents.slice(VISIBLE_INCIDENTS).map((incident) => (
													<IncidentItem key={incident.id} incident={incident} />
												))}
											</ul>
										</details>
									) : null}
								</>
							)}
						</section>
					) : null}

					<section className="mb-10" aria-labelledby="failover-heading">
						<h2
							id="failover-heading"
							className="mb-2 flex items-center gap-2 text-xl font-semibold"
						>
							<Shuffle className="h-5 w-5 text-primary" />
							Automatic failover
						</h2>
						<p className="mb-4 max-w-3xl text-sm text-muted-foreground">
							When {provider.name} fails or slows down, LLM Gateway retries the
							request on another healthy provider serving the same model, with
							no change to your code.{" "}
							{models.length > 0
								? `${withFailover.length} of ${models.length} ${provider.name} models can fail over.`
								: null}
						</p>
						{shownModels.length > 0 ? (
							<ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{shownModels.map((model) => (
									<li key={model.id}>
										<Link
											href={`/models/${encodeURIComponent(model.id)}/uptime`}
											className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-4 py-3 text-sm hover:bg-muted/40"
										>
											<span className="truncate font-medium">{model.name}</span>
											<span className="shrink-0 text-xs text-muted-foreground">
												+{model.alternatives} provider
												{model.alternatives === 1 ? "" : "s"}
											</span>
										</Link>
									</li>
								))}
							</ul>
						) : null}
					</section>

					<section className="mb-10 flex flex-wrap gap-3 text-sm">
						<Link
							href={`/providers/${provider.id}`}
							className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-2 hover:bg-muted/40"
						>
							{provider.name} models and pricing
						</Link>
						{statusPageUrl ? (
							<a
								href={statusPageUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-2 hover:bg-muted/40"
							>
								Official status page
								<ArrowUpRight className="h-3.5 w-3.5" />
							</a>
						) : null}
					</section>

					<section aria-labelledby="faq-heading">
						<h2 id="faq-heading" className="mb-4 text-xl font-semibold">
							Frequently asked questions
						</h2>
						<div className="grid gap-4 md:grid-cols-2">
							{faqs.map((faq) => (
								<div
									key={faq.question}
									className="rounded-lg border border-border/60 p-5"
								>
									<h3 className="mb-2 font-semibold">{faq.question}</h3>
									<p className="text-sm text-muted-foreground">{faq.answer}</p>
								</div>
							))}
						</div>
					</section>
				</div>
			</main>
			<Footer />
		</>
	);
}

export function generateStaticParams() {
	return statusProviders.map((provider) => ({ provider: provider.id }));
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { provider: providerId } = await params;
	const provider = findStatusProvider(providerId);
	if (!provider) {
		return {};
	}
	const title = `${provider.name} Status — Is ${provider.name} Down?`;
	const description = `Live ${provider.name} API status: official incidents, component health, and the 90-day uptime LLM Gateway measured on real ${provider.name} traffic, with automatic failover.`;
	const canonical = `/status/${provider.id}`;
	return {
		title: pageTitle(title),
		description,
		alternates: { canonical },
		keywords: [
			`${provider.name} status`,
			`is ${provider.name} down`,
			`${provider.name} outage`,
			`${provider.name} uptime`,
			`${provider.name} API status`,
		],
		openGraph: {
			title: `${title} | LLM Gateway`,
			description,
			type: "website",
			url: `https://llmgateway.io${canonical}`,
		},
		twitter: {
			card: "summary_large_image",
			title: `${title} | LLM Gateway`,
			description,
		},
	};
}
