import {
	Activity,
	ArrowLeft,
	Clock,
	Gauge,
	ShieldCheck,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { ModelUptimeCharts } from "@/components/models/model-uptime-charts";
import { Badge } from "@/lib/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	expandAllProviderRegions,
	type ModelDefinition,
} from "@llmgateway/models";

import type { Metadata } from "next";

interface PageProps {
	params: Promise<{ name: string }>;
}

export default async function ModelUptimePage({ params }: PageProps) {
	const { name } = await params;
	const decodedName = decodeURIComponent(name);

	const modelDef = modelDefinitions.find(
		(m) => m.id === decodedName,
	) as ModelDefinition;

	if (!modelDef) {
		notFound();
	}

	const expandedProviders = expandAllProviderRegions(modelDef.providers);
	const providerNames = Array.from(
		new Set(
			expandedProviders.map((p) => {
				const info = providerDefinitions.find((pd) => pd.id === p.providerId);
				return info?.name ?? p.providerId;
			}),
		),
	);
	const providerCount = providerNames.length;
	const modelLabel = modelDef.name ?? modelDef.id;
	const modelUrl = `https://llmgateway.io/models/${encodeURIComponent(decodedName)}`;
	const uptimeUrl = `${modelUrl}/uptime`;

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
				name: "Models",
				item: "https://llmgateway.io/models",
			},
			{
				"@type": "ListItem",
				position: 3,
				name: modelLabel,
				item: modelUrl,
			},
			{
				"@type": "ListItem",
				position: 4,
				name: "Uptime",
				item: uptimeUrl,
			},
		],
	};

	const datasetSchema = {
		"@context": "https://schema.org",
		"@type": "Dataset",
		name: `${modelLabel} provider uptime — last 4 hours`,
		description: `Live request volume, error rates, latency (TTFT and total duration), and throughput for every provider serving ${modelLabel} on LLM Gateway, refreshed every minute over the last 4 hours.`,
		url: uptimeUrl,
		isAccessibleForFree: true,
		license: "https://llmgateway.io/legal/terms",
		creator: {
			"@type": "Organization",
			name: "LLM Gateway",
			url: "https://llmgateway.io",
		},
		variableMeasured: [
			"Requests",
			"Error rate",
			"Time to first token (TTFT)",
			"Average duration",
			"Tokens per second",
			"Uptime percent",
		],
		temporalCoverage: "PT4H",
		keywords: [
			modelLabel,
			"uptime",
			"latency",
			"reliability",
			"AI model status",
		],
	};

	const faqSchema = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: [
			{
				"@type": "Question",
				name: `How is ${modelLabel} uptime measured?`,
				acceptedAnswer: {
					"@type": "Answer",
					text: `Uptime is the share of requests that completed successfully on the upstream provider over the last 4 hours. Client errors (4xx from your request) and gateway errors are excluded so the number reflects the provider's reliability, not user errors.`,
				},
			},
			{
				"@type": "Question",
				name: `Which providers serve ${modelLabel}?`,
				acceptedAnswer: {
					"@type": "Answer",
					text: `${modelLabel} is currently served by ${providerCount} provider${providerCount === 1 ? "" : "s"}: ${providerNames.join(", ")}. LLM Gateway routes requests to the best healthy provider in real time.`,
				},
			},
			{
				"@type": "Question",
				name: `What is TTFT and why does it matter?`,
				acceptedAnswer: {
					"@type": "Answer",
					text: `TTFT (time to first token) is the latency between the request and the first streamed token. Lower TTFT means the model starts responding faster — critical for chat UIs and agent loops.`,
				},
			},
			{
				"@type": "Question",
				name: `How often does this page update?`,
				acceptedAnswer: {
					"@type": "Answer",
					text: `Charts refresh every minute and aggregate the most recent 4 hours of traffic across all LLM Gateway projects. Data points are bucketed by minute.`,
				},
			},
		],
	};

	return (
		<>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(breadcrumbSchema),
				}}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(datasetSchema),
				}}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(faqSchema),
				}}
			/>
			<Navbar />
			<div className="min-h-screen bg-background pt-24 md:pt-32 pb-16">
				<div className="container mx-auto px-4 py-8">
					<div className="mb-6">
						<Link
							href={`/models/${encodeURIComponent(decodedName)}`}
							className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
						>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to {modelLabel}
						</Link>
					</div>

					<header className="mb-8 max-w-3xl">
						<div className="flex items-center gap-2 mb-3">
							<Badge variant="outline" className="gap-1.5">
								<span className="relative flex h-2 w-2">
									<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
									<span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
								</span>
								Live
							</Badge>
							<Badge variant="outline">Last 4 hours</Badge>
						</div>
						<h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
							{modelLabel} uptime &amp; latency
						</h1>
						<p className="text-muted-foreground text-base md:text-lg">
							Real-time reliability for every provider serving{" "}
							<strong className="text-foreground">{modelLabel}</strong> on LLM
							Gateway. Compare success rates, time-to-first-token, throughput,
							and error breakdown across {providerCount} provider
							{providerCount === 1 ? "" : "s"} so you can pick the fastest, most
							stable route for your workload.
						</p>
					</header>

					<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
						<MetricCard
							icon={ShieldCheck}
							label="Uptime"
							value="Per provider"
							hint="Share of requests with no upstream error"
						/>
						<MetricCard
							icon={Clock}
							label="Latency"
							value="TTFT + duration"
							hint="Time to first token and total duration in ms"
						/>
						<MetricCard
							icon={Gauge}
							label="Throughput"
							value="Tokens / sec"
							hint="Sustained generation speed across requests"
						/>
						<MetricCard
							icon={Activity}
							label="Errors"
							value="Client / gateway / upstream"
							hint="Failure source breakdown"
						/>
					</div>

					<section className="mb-8">
						<div className="flex flex-col md:flex-row md:items-end md:justify-between mb-6 gap-2">
							<div>
								<h2 className="text-xl md:text-2xl font-semibold mb-1">
									Provider performance
								</h2>
								<p className="text-sm text-muted-foreground">
									Each card shows live traffic from the last 4 hours. Switch
									tabs to inspect requests, errors, latency, or token volume.
								</p>
							</div>
						</div>
						<ModelUptimeCharts modelId={decodedName} />
					</section>

					<section className="mb-12">
						<Card>
							<CardHeader>
								<CardTitle className="text-lg flex items-center gap-2">
									<Zap className="h-4 w-4 text-primary" />
									How LLM Gateway uses these metrics
								</CardTitle>
								<CardDescription>
									Routing happens automatically — these charts show the data
									behind it.
								</CardDescription>
							</CardHeader>
							<CardContent className="text-sm text-muted-foreground space-y-3">
								<p>
									Every {modelLabel} request flowing through LLM Gateway is
									scored on uptime, latency, and throughput. When an upstream
									provider degrades, traffic shifts to the next-best healthy
									endpoint without any client-side changes.
								</p>
								<p>
									Use this page to verify SLA performance, debug regressions, or
									pick a primary provider for a self-hosted deployment.
								</p>
							</CardContent>
						</Card>
					</section>

					<section className="mb-4">
						<h2 className="text-xl md:text-2xl font-semibold mb-4">
							Frequently asked questions
						</h2>
						<div className="grid gap-4 md:grid-cols-2">
							<FaqItem
								question={`How is ${modelLabel} uptime measured?`}
								answer={`Uptime is the share of requests that completed successfully on the upstream provider over the last 4 hours. Client errors (4xx from your request) and gateway errors are excluded so the number reflects the provider's reliability, not user errors.`}
							/>
							<FaqItem
								question={`Which providers serve ${modelLabel}?`}
								answer={`${modelLabel} is currently served by ${providerCount} provider${providerCount === 1 ? "" : "s"}: ${providerNames.join(", ")}. LLM Gateway routes requests to the best healthy provider in real time.`}
							/>
							<FaqItem
								question="What is TTFT and why does it matter?"
								answer="TTFT (time to first token) is the latency between the request and the first streamed token. Lower TTFT means the model starts responding faster — critical for chat UIs and agent loops."
							/>
							<FaqItem
								question="How often does this page update?"
								answer="Charts refresh every minute and aggregate the most recent 4 hours of traffic across all LLM Gateway projects. Data points are bucketed by minute."
							/>
						</div>
					</section>
				</div>
			</div>
			<Footer />
		</>
	);
}

function MetricCard({
	icon: Icon,
	label,
	value,
	hint,
}: {
	icon: typeof Activity;
	label: string;
	value: string;
	hint: string;
}) {
	return (
		<div className="rounded-lg border border-border/60 bg-muted/30 p-4">
			<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground mb-2">
				<Icon className="h-3.5 w-3.5" />
				{label}
			</div>
			<div className="text-base font-semibold">{value}</div>
			<div className="text-xs text-muted-foreground mt-1">{hint}</div>
		</div>
	);
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
	return (
		<div className="rounded-lg border border-border/60 p-5">
			<h3 className="font-semibold mb-2">{question}</h3>
			<p className="text-sm text-muted-foreground">{answer}</p>
		</div>
	);
}

export async function generateStaticParams() {
	return modelDefinitions.map((model) => ({
		name: encodeURIComponent(model.id),
	}));
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { name } = await params;
	const decodedName = decodeURIComponent(name);
	const model = modelDefinitions.find((m) => m.id === decodedName) as
		| ModelDefinition
		| undefined;

	if (!model) {
		return {};
	}

	const expandedProviders = expandAllProviderRegions(model.providers);
	const providerCount = new Set(expandedProviders.map((p) => p.providerId))
		.size;
	const modelLabel = model.name ?? model.id;

	const title = `${modelLabel} Uptime & Latency — Live Provider Status`;
	const description = `Live ${modelLabel} reliability across ${providerCount} provider${providerCount === 1 ? "" : "s"}: uptime %, time-to-first-token, throughput, and error rates from the last 4 hours.`;

	const canonical = `/models/${encodeURIComponent(decodedName)}/uptime`;
	const primaryProvider = model.providers[0]?.providerId || "default";
	const ogImageUrl = `/models/${encodeURIComponent(decodedName)}/${encodeURIComponent(primaryProvider)}/opengraph-image`;

	return {
		title,
		description,
		alternates: {
			canonical,
		},
		keywords: [
			`${modelLabel} uptime`,
			`${modelLabel} latency`,
			`${modelLabel} status`,
			`${modelLabel} reliability`,
			`${modelLabel} TTFT`,
			"LLM Gateway",
			"AI model status",
		],
		openGraph: {
			title,
			description,
			type: "website",
			url: canonical,
			images: [
				{
					url: ogImageUrl,
					width: 1200,
					height: 630,
					alt: `${modelLabel} uptime status`,
				},
			],
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
			images: [ogImageUrl],
		},
		robots: {
			index: true,
			follow: true,
		},
	};
}
