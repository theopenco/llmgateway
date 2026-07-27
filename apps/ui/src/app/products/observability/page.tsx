import {
	Activity,
	AlertTriangle,
	ChartColumnBig,
	CircleDollarSign,
	ScrollText,
	UsersRound,
} from "lucide-react";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import {
	ProductClosingCta,
	ProductFeatureGrid,
	ProductHero,
	ProductScreenshot,
	productJsonLd,
} from "@/components/products/product-sections";

import type { Metadata } from "next";

const title = "Observability — LLM Usage, Cost & Latency Analytics";
const description =
	"Monitor every LLM request in real time: cost analytics, per-model and per-provider breakdowns, error and cache rates, latency, and full request logs — across every provider you use.";

export const metadata: Metadata = {
	title,
	description,
	alternates: { canonical: "/products/observability" },
	openGraph: {
		title,
		description,
		url: "https://llmgateway.io/products/observability",
		type: "website",
	},
};

const features = [
	{
		icon: Activity,
		title: "Request-level activity",
		description:
			"Inspect every API request — prompt, response, tokens, cost, latency, finish reason, and the provider that served it.",
	},
	{
		icon: CircleDollarSign,
		title: "Cost-aware analytics",
		description:
			"See requests, tokens, total spend, and average cost per 1K tokens across 7 or 30 days — split by credits and provider keys.",
	},
	{
		icon: ChartColumnBig,
		title: "Model & provider breakdown",
		description:
			"Break down usage and spend by provider and model to spot expensive outliers quickly.",
	},
	{
		icon: AlertTriangle,
		title: "Errors & reliability",
		description:
			"Monitor error rate, cache hit rate, and reliability trends directly from the dashboard — before your users notice.",
	},
	{
		icon: UsersRound,
		title: "Org & member analytics",
		description:
			"Roll costs up across every project in your organization and break usage down per team member.",
	},
	{
		icon: ScrollText,
		title: "Audit logs",
		description:
			"Track who did what, when — comprehensive audit trails for SOC 2 and HIPAA-ready compliance workflows.",
	},
];

export default function ObservabilityProductPage() {
	const jsonLd = productJsonLd({
		slug: "observability",
		name: "Observability",
		description,
	});

	return (
		<>
			{jsonLd.map((schema, i) => (
				<script
					key={i}
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
				/>
			))}
			<Navbar />
			<main className="min-h-screen bg-background">
				<ProductHero
					accent="violet"
					eyebrow="Product · Observability"
					title="See every request. Know every cost."
					subtitle="Real-time analytics for your entire LLM stack."
					description="LLM Gateway records every request that flows through it — usage, spend, latency, errors, and cache performance — and turns it into dashboards your whole team can act on. No agents to install, no separate tracing SDK."
					ctas={[
						{ label: "Open your dashboard", href: "/dashboard" },
						{
							label: "Explore the Knowledge base",
							href: "https://docs.llmgateway.io/learn",
							external: true,
							variant: "outline",
						},
					]}
					stats={[
						{ value: "100%", label: "Requests captured" },
						{ value: "7/30d", label: "Analytics windows" },
						{ value: "90d", label: "Enterprise retention" },
					]}
				/>

				<div className="mx-auto max-w-6xl space-y-24 px-6 py-20 md:space-y-36 md:py-28">
					<section className="space-y-24 md:space-y-32">
						<ProductScreenshot
							slug="dashboard"
							alt="LLM Gateway analytics dashboard with usage and cost metrics"
							title="Your LLM operations at a glance"
							description="Real-time usage metrics, cost breakdowns, and performance monitoring across all your LLM operations."
						/>
						<ProductScreenshot
							slug="activity"
							alt="LLM Gateway activity view with per-request logs"
							title="Every request, inspectable"
							description="Filter request logs by model, provider, API key, finish reason, or session — then drill into any single request."
						/>
						<ProductScreenshot
							slug="usage"
							alt="LLM Gateway usage and metrics charts"
							title="Usage & metrics"
							description="Requests, models, errors, caching, and costs — dedicated charts for each, per project or across your org."
						/>
						<ProductScreenshot
							slug="model-usage"
							alt="LLM Gateway usage broken down by model"
							title="Spend by model, not just in total"
							description="Stack usage by model or provider over any window to spot the expensive outliers."
						/>
					</section>

					<ProductFeatureGrid
						title="Observability that pays for itself"
						features={features}
					/>
				</div>

				<ProductClosingCta
					accent="violet"
					title="Know what your AI actually costs"
					description="Every plan includes observability — start free with your own provider keys."
					ctas={[
						{ label: "Get started", href: "/signup" },
						{
							label: "View features",
							href: "/features/cost-aware-analytics",
							variant: "outline",
						},
					]}
				/>
			</main>
			<Footer />
		</>
	);
}
