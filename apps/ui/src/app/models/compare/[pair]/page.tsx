import { ArrowRight, Check, Minus } from "lucide-react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import {
	buildComparisonSummary,
	canonicalComparisonSlug,
	comparisonPath,
	featuredComparisons,
	featuredComparisonsForModel,
	formatReleaseDate,
	formatUsd,
	isFeaturedComparison,
	parseComparisonSlug,
	workloadCost,
	type ComparisonModel,
} from "@/lib/model-comparisons";
import { buildFaqSchema } from "@/lib/model-faq";
import { pageTitle } from "@/lib/page-title";

import { formatNumber } from "@llmgateway/shared/number-format";

import type { Metadata, Route } from "next";
import type { ReactNode } from "react";

interface PageProps {
	params: Promise<{ pair: string }>;
}

const BASE_URL = "https://llmgateway.io";

const WORKLOADS = [
	{ label: "1M input + 250K output tokens", input: 1e6, output: 2.5e5 },
	{ label: "10M input + 2.5M output tokens", input: 1e7, output: 2.5e6 },
	{ label: "100M input + 25M output tokens", input: 1e8, output: 2.5e7 },
];

function Capability({ value }: { value: boolean }) {
	return value ? (
		<span className="inline-flex items-center gap-1.5">
			<Check className="h-4 w-4 text-emerald-500" aria-hidden />
			Yes
		</span>
	) : (
		<span className="inline-flex items-center gap-1.5 text-muted-foreground">
			<Minus className="h-4 w-4" aria-hidden />
			No
		</span>
	);
}

function specRows(
	left: ComparisonModel,
	right: ComparisonModel,
): Array<{ label: string; left: ReactNode; right: ReactNode }> {
	const cell = (
		render: (model: ComparisonModel) => ReactNode,
	): { left: ReactNode; right: ReactNode } => ({
		left: render(left),
		right: render(right),
	});
	return [
		{
			label: "Input price (per 1M tokens)",
			...cell((m) => formatUsd(m.inputPrice)),
		},
		{
			label: "Output price (per 1M tokens)",
			...cell((m) => formatUsd(m.outputPrice)),
		},
		{
			label: "Cached input price (per 1M tokens)",
			...cell((m) =>
				m.cachedInputPrice === null ? "—" : formatUsd(m.cachedInputPrice),
			),
		},
		{
			label: "Context window",
			...cell((m) => `${formatNumber(m.contextSize)} tokens`),
		},
		{
			label: "Max output",
			...cell((m) =>
				m.maxOutput > 0 ? `${formatNumber(m.maxOutput)} tokens` : "—",
			),
		},
		{
			label: "Released",
			...cell((m) => (m.releasedAt ? formatReleaseDate(m.releasedAt) : "—")),
		},
		{
			label: "Image input",
			...cell((m) => <Capability value={m.vision} />),
		},
		{
			label: "Tool calling",
			...cell((m) => <Capability value={m.tools} />),
		},
		{
			label: "Reasoning",
			...cell((m) => <Capability value={m.reasoning} />),
		},
		{
			label: "Strict JSON schema output",
			...cell((m) => <Capability value={m.jsonOutputSchema} />),
		},
		{
			label: "Native web search",
			...cell((m) => <Capability value={m.webSearch} />),
		},
		{
			label: "Providers",
			...cell((m) => m.providerNames.join(", ")),
		},
	];
}

function resolvePair(pairParam: string) {
	const slug = decodeURIComponent(pairParam);
	const pair = parseComparisonSlug(slug);
	if (!pair) {
		return null;
	}
	return {
		...pair,
		slug,
		canonicalSlug: canonicalComparisonSlug(pair.left.id, pair.right.id),
	};
}

export default async function ModelPairComparisonPage({ params }: PageProps) {
	const { pair: pairParam } = await params;
	const resolved = resolvePair(pairParam);
	if (!resolved) {
		notFound();
	}
	if (resolved.slug !== resolved.canonicalSlug) {
		permanentRedirect(comparisonPath(resolved.canonicalSlug));
	}

	const { left, right, slug } = resolved;
	const summary = buildComparisonSummary(left, right);
	const title = `${left.name} vs ${right.name}`;
	const url = `${BASE_URL}${comparisonPath(slug)}`;
	const tiered = left.tiered || right.tiered;
	const related = [
		...featuredComparisonsForModel(left.id).map((item) => ({
			...item,
			base: left,
		})),
		...featuredComparisonsForModel(right.id).map((item) => ({
			...item,
			base: right,
		})),
	]
		.filter((item) => item.slug !== slug)
		.slice(0, 12);

	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
			{
				"@type": "ListItem",
				position: 2,
				name: "Models",
				item: `${BASE_URL}/models`,
			},
			{
				"@type": "ListItem",
				position: 3,
				name: "Compare",
				item: `${BASE_URL}/models/compare`,
			},
			{ "@type": "ListItem", position: 4, name: title, item: url },
		],
	};
	const webPageSchema = {
		"@context": "https://schema.org",
		"@type": "WebPage",
		name: `${title}: pricing, context window and capabilities`,
		url,
		description: summary.verdict,
		// Not Product: Google reads Product + Offer as a merchant listing.
		about: [left, right].map((model) => ({
			"@type": "Thing",
			name: model.name,
			url: `${BASE_URL}/models/${encodeURIComponent(model.id)}`,
		})),
	};

	return (
		<>
			<JsonLd
				data={[breadcrumbSchema, webPageSchema, buildFaqSchema(summary.faqs)]}
			/>
			<Navbar />
			<main className="min-h-screen bg-background pt-24 pb-16 md:pt-32">
				<div className="container mx-auto max-w-5xl px-4">
					<nav aria-label="Breadcrumb" className="mb-6 text-sm">
						<ol className="flex flex-wrap items-center gap-2 text-muted-foreground">
							<li>
								<Link href="/models" className="hover:text-foreground">
									Models
								</Link>
							</li>
							<li aria-hidden>/</li>
							<li>
								<Link href="/models/compare" className="hover:text-foreground">
									Compare
								</Link>
							</li>
							<li aria-hidden>/</li>
							<li className="text-foreground" aria-current="page">
								{title}
							</li>
						</ol>
					</nav>

					<header className="mb-10">
						<h1 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">
							{title}
						</h1>
						<p className="mt-4 max-w-3xl text-lg leading-relaxed text-muted-foreground">
							{summary.verdict}
						</p>
					</header>

					<section aria-labelledby="specs-heading" className="mb-12">
						<h2
							id="specs-heading"
							className="mb-4 text-xl font-semibold md:text-2xl"
						>
							{title}: pricing, context window and capabilities
						</h2>
						<div className="overflow-x-auto rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead scope="col" className="min-w-48">
											Spec
										</TableHead>
										{[left, right].map((model) => (
											<TableHead key={model.id} scope="col">
												<Link
													href={
														`/models/${encodeURIComponent(model.id)}` as Route
													}
													className="font-semibold text-foreground hover:underline"
												>
													{model.name}
												</Link>
											</TableHead>
										))}
									</TableRow>
								</TableHeader>
								<TableBody>
									{specRows(left, right).map((row) => (
										<TableRow key={row.label}>
											<TableHead scope="row" className="font-medium">
												{row.label}
											</TableHead>
											<TableCell className="whitespace-normal">
												{row.left}
											</TableCell>
											<TableCell className="whitespace-normal">
												{row.right}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
						<p className="mt-3 text-sm text-muted-foreground">
							Prices are list prices from the cheapest provider LLM Gateway
							routes to for each model.
							{tiered
								? " Some providers charge more above a prompt-size threshold; the model pages list every tier."
								: ""}
						</p>
					</section>

					<section aria-labelledby="cost-heading" className="mb-12">
						<h2
							id="cost-heading"
							className="mb-4 text-xl font-semibold md:text-2xl"
						>
							What {left.name} and {right.name} cost at volume
						</h2>
						<div className="overflow-x-auto rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead scope="col" className="min-w-48">
											Monthly usage
										</TableHead>
										<TableHead scope="col">{left.name}</TableHead>
										<TableHead scope="col">{right.name}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{WORKLOADS.map((workload) => (
										<TableRow key={workload.label}>
											<TableHead scope="row" className="font-medium">
												{workload.label}
											</TableHead>
											{[left, right].map((model) => (
												<TableCell key={model.id}>
													{formatUsd(
														workloadCost(
															model,
															workload.input,
															workload.output,
														),
													)}
												</TableCell>
											))}
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</section>

					<section aria-labelledby="choose-heading" className="mb-12">
						<h2
							id="choose-heading"
							className="mb-4 text-xl font-semibold md:text-2xl"
						>
							When to choose each model
						</h2>
						<div className="grid gap-4 md:grid-cols-2">
							{[
								{ model: left, wins: summary.leftWins },
								{ model: right, wins: summary.rightWins },
							].map(({ model, wins }) => (
								<div key={model.id} className="rounded-lg border p-5">
									<h3 className="font-semibold">Choose {model.name} for</h3>
									{wins.length > 0 ? (
										<ul className="mt-3 space-y-2 text-muted-foreground">
											{wins.map((win) => (
												<li key={win} className="flex gap-2">
													<Check
														className="mt-1 h-4 w-4 shrink-0 text-emerald-500"
														aria-hidden
													/>
													{win}
												</li>
											))}
										</ul>
									) : (
										<p className="mt-3 text-muted-foreground">
											No advantage on price, context window, release date or
											listed capabilities. Test it on your own prompts before
											ruling it out.
										</p>
									)}
									<Link
										href={`/models/${encodeURIComponent(model.id)}` as Route}
										className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
									>
										{model.name} pricing and providers
										<ArrowRight className="h-3.5 w-3.5" aria-hidden />
									</Link>
								</div>
							))}
						</div>
						<p className="mt-4 text-muted-foreground">
							Both models run on the same OpenAI-compatible endpoint, so you can
							send the same prompt to each and compare the output.{" "}
							<Link
								href={
									`/models/compare?left=${encodeURIComponent(left.id)}&right=${encodeURIComponent(right.id)}` as Route
								}
								className="font-medium text-foreground underline underline-offset-4"
							>
								Open this pair in the comparison&nbsp;tool
							</Link>{" "}
							to pin a provider or region.
						</p>
					</section>

					<section aria-labelledby="faq-heading" className="mb-12 max-w-3xl">
						<h2
							id="faq-heading"
							className="mb-6 text-xl font-semibold md:text-2xl"
						>
							{title}: frequently asked questions
						</h2>
						<div className="space-y-6">
							{summary.faqs.map((faq) => (
								<div key={faq.question}>
									<h3 className="mb-2 font-semibold">{faq.question}</h3>
									<p className="leading-relaxed text-muted-foreground">
										{faq.answer}
									</p>
								</div>
							))}
						</div>
					</section>

					{related.length > 0 && (
						<section aria-labelledby="related-heading">
							<h2
								id="related-heading"
								className="mb-4 text-xl font-semibold md:text-2xl"
							>
								More model comparisons
							</h2>
							<ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{related.map((item) => (
									<li key={item.slug}>
										<Link
											href={comparisonPath(item.slug) as Route}
											className="block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
										>
											{item.base.name} vs {item.other.name}
										</Link>
									</li>
								))}
							</ul>
						</section>
					)}
				</div>
			</main>
			<Footer />
		</>
	);
}

export function generateStaticParams() {
	return featuredComparisons.map((pair) => ({ pair: pair.slug }));
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { pair: pairParam } = await params;
	const resolved = resolvePair(pairParam);
	if (!resolved) {
		return {};
	}
	const { left, right, canonicalSlug } = resolved;
	const title = `${left.name} vs ${right.name}: Pricing & Specs Compared`;
	const description = `${left.name} costs ${formatUsd(left.inputPrice)} in / ${formatUsd(left.outputPrice)} out per 1M tokens; ${right.name} costs ${formatUsd(right.inputPrice)} / ${formatUsd(right.outputPrice)}. Compare context window, capabilities and cost at volume.`;
	const canonical = `${BASE_URL}${comparisonPath(canonicalSlug)}`;
	return {
		title: pageTitle(title),
		description,
		alternates: { canonical },
		robots: isFeaturedComparison(canonicalSlug)
			? undefined
			: { index: false, follow: true },
		openGraph: { title, description, type: "website", url: canonical },
		twitter: { card: "summary_large_image", title, description },
	};
}
