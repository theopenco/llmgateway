import {
	CheckCircle,
	ArrowRight,
	Lightbulb,
	Code2,
	ExternalLink,
	Sparkles,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityLogsDemo } from "@/components/features/activity-logs-demo";
import { ApiKeyDemo } from "@/components/features/api-key-demo";
import { CostAnalyticsDemo } from "@/components/features/cost-analytics-demo";
import { ErrorsMonitoringDemo } from "@/components/features/errors-monitoring-demo";
import { ModelBreakdownDemo } from "@/components/features/model-breakdown-demo";
import { MultiProviderDemo } from "@/components/features/multi-provider-demo";
import { PerformanceMonitoringDemo } from "@/components/features/performance-monitoring-demo";
import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { getConfig } from "@/lib/config-server";
import { features, getFeatureBySlug } from "@/lib/features";

import type { Metadata } from "next";

interface PageProps {
	params: Promise<{ slug: string }>;
}

const demoComponents = {
	"multi-provider": MultiProviderDemo,
	"performance-monitoring": PerformanceMonitoringDemo,
	"api-key": ApiKeyDemo,
	"cost-analytics": CostAnalyticsDemo,
	"model-breakdown": ModelBreakdownDemo,
	"errors-monitoring": ErrorsMonitoringDemo,
	"activity-logs": ActivityLogsDemo,
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
		mainEntity: {
			"@type": "SoftwareApplication",
			name: `LLM Gateway - ${feature.title}`,
			applicationCategory: "DeveloperApplication",
			operatingSystem: "Web",
			description: feature.longDescription,
			offers: {
				"@type": "Offer",
				price: "0",
				priceCurrency: "USD",
			},
			featureList: feature.benefits.map((b) => b.title),
		},
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
					__html: JSON.stringify(featureSchema),
				}}
			/>
			<Navbar />
			<div className="min-h-screen bg-background">
				<div className="relative border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-b from-zinc-50 to-background dark:from-zinc-900/50 dark:to-background">
					<div className="container mx-auto px-4 py-16 md:py-24 pt-32 md:pt-40">
						<div className="max-w-4xl mx-auto text-center">
							<Badge variant="outline" className="mb-4">
								Feature
							</Badge>
							<h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
								{feature.title}
							</h1>
							<p className="text-xl md:text-2xl text-muted-foreground mb-8">
								{feature.subtitle}
							</p>
							<p className="text-lg text-muted-foreground mb-8 max-w-3xl mx-auto">
								{feature.longDescription}
							</p>
							<div className="flex flex-wrap justify-center gap-4">
								<Link href="/signup">
									<Button size="lg" className="gap-2">
										Get Started
										<ArrowRight className="h-4 w-4" />
									</Button>
								</Link>
								<a
									href={config.playgroundUrl}
									target="_blank"
									rel="noopener noreferrer"
								>
									<Button variant="outline" size="lg" className="gap-2">
										Try in Playground
										<ExternalLink className="h-4 w-4" />
									</Button>
								</a>
							</div>
						</div>
					</div>
				</div>

				<div className="container mx-auto px-4 py-16">
					<div className="max-w-6xl mx-auto">
						<section className="mb-16">
							<div className="flex items-center gap-3 mb-8">
								<CheckCircle className="h-8 w-8 text-green-600 dark:text-green-500" />
								<h2 className="text-3xl font-bold">Key Benefits</h2>
							</div>
							<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
								{feature.benefits.map((benefit, index) => (
									<div
										key={index}
										className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card hover:shadow-lg transition-shadow"
									>
										<h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
											<CheckCircle className="h-5 w-5 text-green-600 dark:text-green-500 flex-shrink-0" />
											{benefit.title}
										</h3>
										<p className="text-muted-foreground">
											{benefit.description}
										</p>
									</div>
								))}
							</div>
						</section>

						{feature.useCases.length > 0 && (
							<section className="mb-16">
								<div className="flex items-center gap-3 mb-8">
									<Lightbulb className="h-8 w-8 text-orange-600 dark:text-orange-500" />
									<h2 className="text-3xl font-bold">Use Cases</h2>
								</div>
								<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
									{feature.useCases.map((useCase, index) => (
										<div
											key={index}
											className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card hover:shadow-lg transition-shadow"
										>
											<h3 className="text-xl font-semibold mb-3">
												{useCase.title}
											</h3>
											<p className="text-muted-foreground">
												{useCase.description}
											</p>
										</div>
									))}
								</div>
							</section>
						)}

						{DemoComponent && (
							<section className="mb-16">
								<div className="flex items-center gap-3 mb-8">
									<Sparkles className="h-8 w-8 text-purple-600 dark:text-purple-500" />
									<h2 className="text-3xl font-bold">Live Demo</h2>
								</div>
								<DemoComponent />
							</section>
						)}

						{feature.codeExample && (
							<section className="mb-16">
								<div className="flex items-center gap-3 mb-8">
									<Code2 className="h-8 w-8 text-blue-600 dark:text-blue-500" />
									<h2 className="text-3xl font-bold">
										{feature.codeExample.title}
									</h2>
								</div>
								<div className="relative">
									<div className="absolute top-4 right-4 z-10">
										<Badge variant="secondary">
											{feature.codeExample.language}
										</Badge>
									</div>
									<pre className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 overflow-x-auto">
										<code className="text-sm text-zinc-50 font-mono">
											{feature.codeExample.code}
										</code>
									</pre>
								</div>
							</section>
						)}

						<section className="border-t border-zinc-200 dark:border-zinc-800 pt-16">
							<div className="text-center max-w-3xl mx-auto">
								<h2 className="text-3xl font-bold mb-4">
									Ready to get started?
								</h2>
								<p className="text-lg text-muted-foreground mb-8">
									Join thousands of developers using LLM Gateway to power their
									AI applications.
								</p>
								<div className="flex flex-wrap justify-center gap-4">
									<Link href="/signup">
										<Button size="lg" className="gap-2">
											Start Building
											<ArrowRight className="h-4 w-4" />
										</Button>
									</Link>
									<Link href="/models">
										<Button variant="outline" size="lg">
											Browse Models
										</Button>
									</Link>
								</div>
							</div>
						</section>
					</div>
				</div>
			</div>
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

	const title = `${feature.title} – LLM Gateway`;
	const description = feature.description;

	return {
		title,
		description,
		openGraph: {
			title,
			description,
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}
