import { Check, X, ExternalLink, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { AuthLink } from "@/components/shared/auth-link";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";

const comparisonData = [
	{
		category: "Deployment & Infrastructure",
		features: [
			{
				title: "Managed infrastructure",
				description: "Fully managed, production-ready deployment",
				llmgateway: true,
				litellm: false,
			},
			{
				title: "Time to first request",
				description: "What you set up before the first API call",
				llmgateway: "Sign up and create a key",
				litellm: "Deploy the gateway; Postgres for keys and UI",
			},
			{
				title: "Self-hosting option",
				description: "Deploy on your own infrastructure (See license)",
				llmgateway: "Free core (AGPLv3)",
				litellm: "Open source (MIT)",
			},
			{
				title: "Auto-scaling",
				description: "Automatic scaling based on traffic",
				llmgateway: true,
				litellm: "Manual setup required",
			},
			{
				title: "Support and SLA",
				description: "Contractual coverage depends on the plan",
				llmgateway: "Enterprise",
				litellm: "Enterprise support SLAs",
			},
		],
	},
	{
		category: "Security & Supply Chain",
		features: [
			{
				title: "Compromised releases in 2026",
				description: "Malicious versions published to official registries",
				llmgateway: "None",
				litellm: "2 (March and October)",
			},
			{
				title: "Gateway code on your hosts",
				description: "A package or container that runs next to your secrets",
				llmgateway: "None with the hosted API",
				litellm: "Python package or proxy container",
			},
			{
				title: "Where provider keys live",
				description: "Where stored provider credentials sit",
				llmgateway: "Encrypted, off your hosts",
				litellm: "Your hosts: env vars or proxy database",
			},
			{
				title: "Patching & supply-chain upkeep",
				description:
					"Who pins versions, applies fixes and responds to a bad release",
				llmgateway: "Managed hosting; self-hosters own updates",
				litellm: "You own it",
			},
			{
				title: "SOC 2 Type II",
				description: "Independently audited security controls",
				llmgateway: true,
				litellm: true,
			},
		],
	},
	{
		category: "Billing & Plans",
		features: [
			{
				title: "One balance for every provider",
				description: "Prepaid credits for 200+ models, no provider accounts",
				llmgateway: true,
				litellm: "Bring your own provider accounts",
			},
			{
				title: "Pricing model",
				description: "How the gateway itself is paid for",
				llmgateway: "5% on credits; BYOK free",
				litellm: "OSS free; Enterprise annual quote",
			},
			{
				title: "Coding agent plan",
				description: "Monthly subscription for coding agents",
				llmgateway: "DevPass",
				litellm: false,
			},
			{
				title: "Billing integration",
				description: "Built-in billing with Stripe integration",
				llmgateway: true,
				litellm: false,
			},
		],
	},
	{
		category: "Analytics & Monitoring",
		features: [
			{
				title: "Real-time cost analytics",
				description: "Detailed cost tracking for every request",
				llmgateway: true,
				litellm: true,
			},
			{
				title: "Latency analytics",
				description: "Real-time performance monitoring with visualizations",
				llmgateway: true,
				litellm: "Admin UI and metrics integrations",
			},
			{
				title: "Request-level insights",
				description: "Granular analytics for each API call",
				llmgateway: true,
				litellm: true,
			},
			{
				title: "Model usage dashboard",
				description: "Comprehensive model usage metrics and trends",
				llmgateway: true,
				litellm: true,
			},
			{
				title: "Budgets and spend tracking",
				description: "Track usage and configure spending controls",
				llmgateway: true,
				litellm: true,
			},
		],
	},
	{
		category: "Enterprise Features",
		features: [
			{
				title: "Team collaboration",
				description: "Multi-user access with role-based permissions",
				llmgateway: true,
				litellm: "Proxy admin UI (RBAC is Enterprise)",
			},
			{
				title: "Project isolation",
				description: "Separate projects with individual API keys",
				llmgateway: true,
				litellm: "Teams & virtual keys",
			},
			{
				title: "Priority support",
				description: "Dedicated support for paid plans",
				llmgateway: "Enterprise",
				litellm: "Enterprise",
			},
			{
				title: "SSO integration",
				description: "Enterprise single sign-on support",
				llmgateway: "Enterprise",
				litellm: "Free up to 5 users, then Enterprise",
			},
		],
	},
	{
		category: "Developer Experience",
		features: [
			{
				title: "OpenAI-compatible API",
				description: "Drop-in replacement for OpenAI API",
				llmgateway: true,
				litellm: true,
			},
			{
				title: "Browser model playground",
				description: "Test models directly in the browser",
				llmgateway: "Lounge",
				litellm: "Admin UI playground",
			},
			{
				title: "API key management",
				description: "Create and manage multiple API keys",
				llmgateway: true,
				litellm: "Virtual keys",
			},
			{
				title: "Request caching",
				description: "Built-in Redis caching for responses",
				llmgateway: true,
				litellm: "Built-in, needs config",
			},
			{
				title: "Comprehensive docs",
				description: "Detailed documentation and guides",
				llmgateway: true,
				litellm: true,
			},
		],
	},
];

const incidents = [
	{
		date: "March 24, 2026",
		title: "litellm 1.82.7 and 1.82.8 on PyPI",
		summary:
			"An attacker published two releases with a maintainer's PyPI credentials, linked to the Trivy CI compromise. A credential stealer harvested environment variables, SSH keys, cloud credentials and Kubernetes tokens.",
		exposure:
			"Live for about 40 minutes. The official proxy Docker image was not affected.",
		sources: [
			{
				label: "FutureSearch analysis",
				href: "https://futuresearch.ai/blog/litellm-pypi-supply-chain-attack/",
			},
			{
				label: "The Hacker News",
				href: "https://thehackernews.com/2026/03/teampcp-backdoors-litellm-versions.html",
			},
		],
	},
	{
		date: "October 21, 2026",
		title: "litellm 1.107.0 on PyPI and Docker",
		summary:
			"The release pipeline was compromised. All seven wheels and the official Docker images shipped an infostealer that read the provider keys stored in the proxy database, plus a remote access trojan that ran attacker code every hour.",
		exposure:
			"About 2 hours on PyPI and 2.5 hours on Docker, including the latest, main-latest and main-stable tags.",
		sources: [
			{
				label: "Aikido analysis",
				href: "https://www.aikido.dev/blog/litellm-compromised-infostealer-rat",
			},
			{
				label: "JFrog analysis",
				href: "https://research.jfrog.com/post/litellm-hijacked-again/",
			},
		],
	},
];

const reasons = [
	{
		title: "Managed infrastructure",
		detail: "with an Enterprise SLA option",
	},
	{
		title: "No proxy to patch",
		detail: "or rebuild and re-key after a bad release",
	},
	{
		title: "One balance",
		detail: "for 200+ models, or BYOK with no platform fee",
	},
	{
		title: "Advanced analytics",
		detail: "with cost optimization insights",
	},
	{
		title: "Enterprise-ready",
		detail: "with team collaboration and SSO",
	},
	{
		title: "SOC 2 Type II",
		detail: "audited, with built-in monitoring",
	},
];

export function ComparisonLiteLLM() {
	const renderFeatureValue = (value: boolean | string) => {
		if (typeof value === "boolean") {
			return value ? (
				<Check className="h-5 w-5 text-green-600 dark:text-green-400" />
			) : (
				<X className="h-5 w-5 text-red-600 dark:text-red-400" />
			);
		}
		return <span className="text-sm font-medium text-foreground">{value}</span>;
	};

	return (
		<section className="w-full py-12 md:py-24 lg:py-32 bg-background">
			<div className="container px-4 md:px-6 max-w-5xl mx-auto">
				<div className="text-center mb-12">
					<Badge variant="outline" className="mb-4">
						Compare platforms
					</Badge>
					<h2 className="text-3xl font-bold tracking-tight mb-2 text-foreground">
						Find the perfect fit
					</h2>
					<p className="text-muted-foreground">
						Compare LLM Gateway and LiteLLM features side by side
					</p>
				</div>

				<div className="mb-8 bg-primary/5 dark:bg-primary/10 rounded-lg p-6 border border-primary/20">
					<h3 className="font-bold text-lg mb-3 text-primary">
						Why choose LLM Gateway?
					</h3>
					<div className="grid md:grid-cols-2 gap-4 text-sm">
						{reasons.map((reason) => (
							<div key={reason.title} className="flex items-start gap-2">
								<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
								<span className="text-foreground">
									<strong>{reason.title}</strong> {reason.detail}
								</span>
							</div>
						))}
					</div>
				</div>

				<div className="mb-8">
					<div className="flex items-center gap-2 mb-2">
						<ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" />
						<h3 className="font-bold text-lg text-foreground">
							LiteLLM was compromised twice in 2026
						</h3>
					</div>
					<p className="text-sm text-muted-foreground mb-4">
						A self-hosted proxy holds every provider key you have. Each incident
						left teams to find every install, rebuild and rotate their keys.
					</p>
					<div className="grid md:grid-cols-2 gap-4">
						{incidents.map((incident) => (
							<div
								key={incident.date}
								className="rounded-lg border border-red-600/20 bg-red-600/5 p-5 dark:border-red-400/20 dark:bg-red-400/5"
							>
								<p className="text-xs font-medium uppercase tracking-wide text-red-600 dark:text-red-400">
									{incident.date}
								</p>
								<h4 className="mt-1 font-semibold text-foreground">
									{incident.title}
								</h4>
								<p className="mt-2 text-sm text-foreground">
									{incident.summary}
								</p>
								<p className="mt-2 text-sm text-muted-foreground">
									{incident.exposure}
								</p>
								<ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
									{incident.sources.map((source) => (
										<li key={source.href}>
											<a
												href={source.href}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex items-center gap-1 underline underline-offset-4 text-muted-foreground hover:text-foreground"
											>
												{source.label}
												<ExternalLink className="h-3 w-3" />
											</a>
										</li>
									))}
								</ul>
							</div>
						))}
					</div>
					<p className="text-sm text-muted-foreground mt-4">
						What to check and rotate:{" "}
						<Link
							href="/blog/litellm-compromised-again"
							className="underline underline-offset-4 hover:text-foreground"
						>
							LiteLLM compromised again
						</Link>
						. How we handle it:{" "}
						<Link
							href="/blog/how-we-keep-llm-gateway-secure"
							className="underline underline-offset-4 hover:text-foreground"
						>
							How we keep LLM Gateway secure
						</Link>
						.
					</p>
				</div>

				<div className="bg-card rounded-lg border border-border overflow-hidden shadow-sm">
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 sm:p-6 bg-muted/50 border-b border-border">
						<div className="hidden md:block" />
						<div className="text-center">
							<div className="border-2 border-primary rounded-lg p-4 bg-background shadow-sm h-full">
								<h3 className="font-bold text-lg mb-1 text-foreground">
									LLM Gateway
								</h3>
								<p className="text-sm text-muted-foreground mb-2">
									MANAGED & PRODUCTION-READY
								</p>
								<p className="text-2xl font-bold text-primary">From $0</p>
								<p className="text-xs text-muted-foreground mt-1">
									Free core; hosting costs separate
								</p>
							</div>
						</div>
						<div className="text-center">
							<div className="border border-border rounded-lg p-4 bg-background h-full">
								<h3 className="font-bold text-lg mb-1 text-foreground">
									LiteLLM
								</h3>
								<p className="text-sm text-muted-foreground mb-2">
									SELF-HOSTED ONLY
								</p>
								<p className="text-2xl font-bold text-foreground">Free</p>
								<p className="text-xs text-muted-foreground mt-1">
									Open source (MIT)
								</p>
							</div>
						</div>
					</div>

					{comparisonData.map((category, categoryIndex) => (
						<div key={categoryIndex}>
							{categoryIndex > 0 && (
								<div className="border-t-2 border-border/50" />
							)}

							{category.features.map((feature, featureIndex) => (
								<div
									key={featureIndex}
									className="grid grid-cols-3 gap-4 p-6 border-b border-border/50 hover:bg-muted/30 transition-colors"
								>
									<div>
										<h4 className="font-semibold text-foreground mb-1">
											{feature.title}
										</h4>
										<p className="text-sm text-muted-foreground">
											{feature.description}
										</p>
									</div>
									<div className="flex justify-center items-center">
										{renderFeatureValue(feature.llmgateway)}
									</div>
									<div className="flex justify-center items-center">
										{renderFeatureValue(feature.litellm)}
									</div>
								</div>
							))}
						</div>
					))}
				</div>

				<div className="text-center mt-8">
					<div className="flex flex-col sm:flex-row gap-4 justify-center">
						<Button size="lg" className="bg-primary hover:bg-primary/90">
							<AuthLink href="/signup">Start Free with LLM Gateway</AuthLink>
						</Button>
						<Button size="lg" variant="outline">
							<Link href="/pricing">View Pricing Details</Link>
						</Button>
					</div>
					<p className="text-sm text-muted-foreground mt-3">
						No credit card required • Self-host option available • Enterprise
						support available
					</p>
					<p className="text-sm text-muted-foreground mt-3">
						Weighing more options? See the{" "}
						<Link
							href="/blog/litellm-alternatives"
							className="underline underline-offset-4 hover:text-foreground"
						>
							8 best LiteLLM alternatives in 2026
						</Link>
						.
					</p>
				</div>
			</div>
		</section>
	);
}
