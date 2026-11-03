import { ArrowRight, ArrowUpRight, BookOpen } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FeatureCode } from "@/components/features/feature-code";
import { FeatureVisual } from "@/components/features/visuals/feature-visual";
import s from "@/components/features/visuals/visuals.module.css";
import { DeveloperSnippet } from "@/components/home/developer-snippet";
import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import { Button } from "@/lib/components/button";
import { getConfig } from "@/lib/config-server";
import {
	features,
	getFeatureBySlug,
	getFeatureCategory,
	getRelatedFeatures,
} from "@/lib/features";
import { cn } from "@/lib/utils";

import type { Metadata } from "next";
import type { CSSProperties } from "react";

interface PageProps {
	params: Promise<{ slug: string }>;
}

// Only the demo matching the route is rendered, so load each one lazily
// instead of bundling all of them (two pull in recharts) into every
// feature page.
const demoComponents = {
	"multi-provider": dynamic(() =>
		import("@/components/features/multi-provider-demo").then(
			(mod) => mod.MultiProviderDemo,
		),
	),
	"performance-monitoring": dynamic(() =>
		import("@/components/features/performance-monitoring-demo").then(
			(mod) => mod.PerformanceMonitoringDemo,
		),
	),
	"api-key": dynamic(() =>
		import("@/components/features/api-key-demo").then((mod) => mod.ApiKeyDemo),
	),
	"cost-analytics": dynamic(() =>
		import("@/components/features/cost-analytics-demo").then(
			(mod) => mod.CostAnalyticsDemo,
		),
	),
	"model-breakdown": dynamic(() =>
		import("@/components/features/model-breakdown-demo").then(
			(mod) => mod.ModelBreakdownDemo,
		),
	),
	"errors-monitoring": dynamic(() =>
		import("@/components/features/errors-monitoring-demo").then(
			(mod) => mod.ErrorsMonitoringDemo,
		),
	),
	"activity-logs": dynamic(() =>
		import("@/components/features/activity-logs-demo").then(
			(mod) => mod.ActivityLogsDemo,
		),
	),
	"audit-logs": null,
	guardrails: null,
};

export default async function FeaturePage({ params }: PageProps) {
	const config = getConfig();
	const { slug } = await params;
	const feature = getFeatureBySlug(slug);

	if (!feature) {
		notFound();
	}

	const DemoComponent = feature.demoComponent
		? demoComponents[feature.demoComponent]
		: null;
	const category = getFeatureCategory(feature.category);
	const related = getRelatedFeatures(feature);
	const Icon = feature.icon;
	const docsHref = feature.docsPath
		? `${config.docsUrl}${feature.docsPath}`
		: null;

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
				name: "Features",
				item: "https://llmgateway.io/features",
			},
			{
				"@type": "ListItem",
				position: 3,
				name: feature.title,
				item: `https://llmgateway.io/features/${slug}`,
			},
		],
	};

	const featureSchema = {
		"@context": "https://schema.org",
		"@type": "WebPage",
		name: feature.title,
		description: feature.longDescription,
		url: `https://llmgateway.io/features/${slug}`,
		image: "https://llmgateway.io/opengraph.png?v=1",
		isPartOf: {
			"@type": "WebSite",
			name: "LLM Gateway",
			url: "https://llmgateway.io",
		},
		about: {
			"@type": "Thing",
			name: `LLM Gateway - ${feature.title}`,
			description: feature.longDescription,
		},
		author: {
			"@type": "Organization",
			name: "LLM Gateway",
			url: "https://llmgateway.io",
		},
	};

	return (
		<>
			<JsonLd data={breadcrumbSchema} />
			<JsonLd data={featureSchema} />
			<Navbar />
			<main
				className="min-h-screen bg-background"
				style={{ "--fa": category.accent } as CSSProperties}
			>
				<section className="relative overflow-hidden border-b border-border">
					<div
						className={cn(
							s.dotGrid,
							"pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]",
						)}
					/>
					<div className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[56rem] -translate-x-1/2 rounded-full bg-[color-mix(in_oklab,var(--fa)_14%,transparent)] blur-3xl" />
					<div className="container relative mx-auto px-4 pb-16 pt-32 md:pb-24 md:pt-40">
						<div className="grid items-center gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
							<div>
								<nav
									aria-label="Breadcrumb"
									className="animate-hero-enter mb-6 flex items-center gap-1.5 text-sm text-muted-foreground"
								>
									<Link
										href="/features"
										className="transition-colors hover:text-foreground"
									>
										Features
									</Link>
									<span aria-hidden>/</span>
									<Link
										href={`/features#${category.id}`}
										className="transition-colors hover:text-foreground"
									>
										{category.label}
									</Link>
								</nav>
								<div className="animate-hero-enter mb-5 flex flex-wrap items-center gap-2">
									<span className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--fa)_35%,transparent)] bg-[color-mix(in_oklab,var(--fa)_10%,transparent)] px-3 py-1 text-xs font-medium">
										<Icon className="size-3.5 text-[var(--fa)]" />
										{feature.subtitle}
									</span>
									{feature.enterprise && (
										<span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
											Enterprise
										</span>
									)}
								</div>
								<h1 className="animate-hero-enter hero-enter-delay-1 text-balance font-display text-4xl font-bold tracking-tight md:text-6xl">
									{feature.title}
								</h1>
								<p className="animate-hero-enter hero-enter-delay-2 mt-5 max-w-xl text-pretty text-lg text-muted-foreground md:text-xl">
									{feature.description}
								</p>
								<div className="animate-hero-enter hero-enter-delay-3 mt-8 flex flex-wrap gap-3">
									<Button
										asChild
										size="lg"
										className="group gap-2 active:scale-[0.97]"
									>
										<Link href="/signup">
											Get started
											<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
										</Link>
									</Button>
									{docsHref ? (
										<Button
											asChild
											variant="outline"
											size="lg"
											className="gap-2 active:scale-[0.97]"
										>
											<a href={docsHref}>
												<BookOpen className="h-4 w-4" />
												Read the docs
											</a>
										</Button>
									) : (
										<Button
											asChild
											variant="outline"
											size="lg"
											className="gap-2 active:scale-[0.97]"
										>
											<a
												href={config.playgroundUrl}
												target="_blank"
												rel="noopener noreferrer"
											>
												Try in Lounge
												<ArrowUpRight className="h-4 w-4" />
											</a>
										</Button>
									)}
								</div>
							</div>
							<div className="animate-hero-enter hero-enter-delay-2">
								<FeatureVisual visual={feature.visual} />
							</div>
						</div>
					</div>
				</section>

				<div className="container mx-auto px-4">
					<section className="py-16 md:py-24">
						<div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
							{feature.benefits.map((benefit, index) => (
								<div
									key={benefit.title}
									className={cn(
										s.lift,
										"scroll-reveal relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-6",
									)}
								>
									<span className="font-mono text-xs text-[var(--fa)]">
										{String(index + 1).padStart(2, "0")}
									</span>
									<h2 className="mt-4 font-semibold tracking-tight sm:mt-6 sm:text-lg">
										{benefit.title}
									</h2>
									<p className="mt-1.5 text-sm text-muted-foreground">
										{benefit.description}
									</p>
									<div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[var(--fa)] to-transparent opacity-60" />
								</div>
							))}
						</div>
					</section>

					{DemoComponent && (
						<section className="scroll-reveal pb-16 md:pb-24">
							<h2 className="mb-8 font-display text-2xl font-bold tracking-tight md:text-3xl">
								See it in the dashboard
							</h2>
							<DemoComponent />
						</section>
					)}

					<section
						className={cn(
							"grid gap-10 pb-16 md:pb-24",
							(feature.codeExample ?? feature.developerSnippet) &&
								"lg:grid-cols-[0.8fr_1.2fr] lg:gap-16",
						)}
					>
						<div className="scroll-reveal">
							<h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
								Built for
							</h2>
							<ul
								className={cn(
									"mt-8 grid gap-3",
									!(feature.codeExample ?? feature.developerSnippet) &&
										"sm:grid-cols-3",
								)}
							>
								{feature.useCases.map((useCase) => (
									<li
										key={useCase.title}
										className="flex gap-4 rounded-2xl border border-border bg-card p-5"
									>
										<span className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--fa)] shadow-[0_0_0_4px_color-mix(in_oklab,var(--fa)_18%,transparent)]" />
										<div>
											<h3 className="font-semibold">{useCase.title}</h3>
											<p className="mt-0.5 text-sm text-muted-foreground">
												{useCase.description}
											</p>
										</div>
									</li>
								))}
							</ul>
						</div>
						{feature.developerSnippet ? (
							<div className="scroll-reveal min-w-0">
								<DeveloperSnippet />
							</div>
						) : (
							feature.codeExample && (
								<div className="scroll-reveal min-w-0">
									<FeatureCode
										slug={feature.slug}
										feature={feature.title}
										title={feature.codeExample.title}
										language={feature.codeExample.language}
										code={feature.codeExample.code}
										docsHref={docsHref ?? config.docsUrl}
									/>
								</div>
							)
						)}
					</section>

					{related.length > 0 && (
						<section className="pb-16 md:pb-24">
							<div className="mb-8 flex items-end justify-between gap-4">
								<h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
									More in {category.label.toLowerCase()}
								</h2>
								<Link
									href="/features"
									className="group inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
								>
									All features
									<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</div>
							<div className="grid gap-4 md:grid-cols-3">
								{related.map((item) => {
									const RelatedIcon = item.icon;
									return (
										<Link
											key={item.slug}
											href={`/features/${item.slug}`}
											className={cn(
												s.lift,
												"scroll-reveal group flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 hover:shadow-md",
											)}
										>
											<span className="flex size-10 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--fa)_12%,transparent)]">
												<RelatedIcon className="size-5 text-[var(--fa)]" />
											</span>
											<div>
												<h3 className="font-semibold">{item.title}</h3>
												<p className="mt-1 text-sm text-muted-foreground">
													{item.subtitle}
												</p>
											</div>
											<ArrowRight className="mt-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
										</Link>
									);
								})}
							</div>
						</section>
					)}

					<section className="scroll-reveal pb-24">
						<div className="relative overflow-hidden rounded-3xl border border-border bg-surface-elevated px-6 py-14 text-center md:py-20">
							<div className="pointer-events-none absolute left-1/2 top-0 h-48 w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color-mix(in_oklab,var(--fa)_20%,transparent)] blur-3xl" />
							<h2 className="relative text-balance font-display text-3xl font-bold tracking-tight md:text-4xl">
								Start using {feature.title} today
							</h2>
							<p className="relative mx-auto mt-3 max-w-md text-muted-foreground">
								One API key. Every model. Live in minutes.
							</p>
							<div className="relative mt-8 flex flex-wrap justify-center gap-3">
								<Button
									asChild
									size="lg"
									className="group gap-2 active:scale-[0.97]"
								>
									<Link href="/signup">
										Start building
										<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
									</Link>
								</Button>
								<Button
									asChild
									variant="outline"
									size="lg"
									className="active:scale-[0.97]"
								>
									<Link href="/models">Browse models</Link>
								</Button>
							</div>
						</div>
					</section>
				</div>
			</main>
			<Footer />
		</>
	);
}

export async function generateStaticParams() {
	return features.map((feature) => ({
		slug: feature.slug,
	}));
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { slug } = await params;
	const feature = getFeatureBySlug(slug);

	if (!feature) {
		return {};
	}

	const withSubtitle = `${feature.title} — ${feature.subtitle}`;
	const title =
		withSubtitle.length + " | LLM Gateway".length <= 60
			? withSubtitle
			: feature.title;
	const leadSentence = feature.longDescription.split(/(?<=[.!?])\s+/)[0];
	const extended = `${feature.description} ${leadSentence}`;
	const description =
		feature.description.length < 110 && extended.length <= 160
			? extended
			: feature.description;

	return {
		title,
		description,
		alternates: {
			canonical: `/features/${feature.slug}`,
		},
		openGraph: {
			title,
			description,
			type: "website",
			url: `https://llmgateway.io/features/${feature.slug}`,
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}
