import { ArrowRight, ChevronRight } from "lucide-react";

import { ProviderLogo } from "@/components/landing/provider-logo";
import dimensions from "@/lib/provider-logo-dimensions.json";
import { cn } from "@/lib/utils";

import { MARKETING_STATS } from "@llmgateway/shared";

import { DeveloperSnippet } from "./developer-snippet";
import { TrackedLink } from "./tracked-link";

const CARRIERS: { id: keyof typeof dimensions; name: string }[] = [
	{ id: "openai", name: "OpenAI" },
	{ id: "anthropic", name: "Anthropic" },
	{ id: "google-vertex", name: "Google Vertex" },
	{ id: "google-ai-studio", name: "Google AI Studio" },
	{ id: "aws-bedrock", name: "AWS Bedrock" },
	{ id: "azure", name: "Azure" },
	{ id: "xai", name: "xAI" },
	{ id: "mistral", name: "Mistral" },
	{ id: "deepseek", name: "DeepSeek" },
	{ id: "alibaba", name: "Alibaba Cloud" },
	{ id: "moonshot", name: "Moonshot" },
	{ id: "zai", name: "Z.ai" },
	{ id: "minimax", name: "MiniMax" },
	{ id: "bytedance", name: "ByteDance" },
	{ id: "tencent", name: "Tencent Cloud" },
	{ id: "baidu", name: "Baidu" },
	{ id: "groq", name: "Groq" },
	{ id: "cerebras", name: "Cerebras" },
	{ id: "together-ai", name: "Together AI" },
	{ id: "fireworks", name: "Fireworks" },
	{ id: "deepinfra", name: "DeepInfra" },
	{ id: "novita", name: "NovitaAI" },
	{ id: "runware", name: "Runware" },
	{ id: "scx-ai-gp", name: "SCX.ai" },
];

function logoHeight(id: keyof typeof dimensions) {
	const logo = dimensions[id];
	if (!("viewBox" in logo)) {
		return "h-7";
	}
	const [, , width, height] = logo.viewBox.split(" ").map(Number);
	const ratio = width / height;
	return ratio > 2.2 ? "h-4" : ratio > 1.3 ? "h-6" : "h-8";
}

const ENDPOINTS = [
	"/v1/chat/completions",
	"/v1/responses",
	"/v1/images/generations",
	"/v1/images/edits",
];

const PLANS = [
	{
		name: "Bring your own keys",
		price: "Free",
		note: "Routing and analytics on your own provider keys",
	},
	{
		name: "Credits",
		price: `${MARKETING_STATS.platformFee} on top-ups`,
		note: "Any model at provider list prices, no token markup. Non-US cards may add a 1.5% card fee.",
	},
	{
		name: "Self-host",
		price: "Free core",
		note: "The open-source gateway on your servers. Enterprise features need a license.",
	},
	{
		name: "Enterprise",
		price: "Custom",
		note: "SSO, audit logs, guardrails and a 99.9% SLA on Enterprise Cloud.",
	},
];

export interface MigrationLink {
	slug: string;
	fromProvider: string;
}

export function DeveloperLane({ migrations }: { migrations: MigrationLink[] }) {
	return (
		<section className="relative py-24 md:py-32">
			<div className="mx-auto max-w-7xl px-4 sm:px-6">
				<div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
					<div className="min-w-0 lg:col-span-5">
						<h2 className="text-balance font-display text-4xl font-bold leading-[1.08] tracking-[-0.03em] md:text-5xl">
							Change two lines.{" "}
							<span className="text-muted-foreground">Keep your SDK.</span>
						</h2>
						<p className="mt-5 text-lg text-muted-foreground">
							Use our AI SDK provider, any OpenAI SDK, cURL or any language. Run
							DevPass Code, Claude Code, Codex, OpenCode or Empryo on any model.
							Switch models by changing one string.
						</p>
						<ul className="mt-5 flex flex-wrap gap-2 font-mono text-xs">
							{ENDPOINTS.map((endpoint) => (
								<li
									key={endpoint}
									className="rounded-md border border-border bg-card px-2.5 py-1 text-foreground/80"
								>
									<span className="text-muted-foreground">POST</span> {endpoint}
								</li>
							))}
						</ul>

						<dl className="mt-8 divide-y divide-border border-y border-border">
							{PLANS.map((plan) => (
								<div
									key={plan.name}
									className="flex items-baseline justify-between gap-4 py-4"
								>
									<div>
										<dt className="font-semibold">{plan.name}</dt>
										<dd className="text-sm text-muted-foreground">
											{plan.note}
										</dd>
									</div>
									<dd className="shrink-0 font-mono text-sm">{plan.price}</dd>
								</div>
							))}
						</dl>

						<div className="mt-8 flex flex-wrap items-center gap-4">
							<TrackedLink
								href="/signup"
								auth
								location="home_developers"
								cta="get_api_key"
								className="group inline-flex items-center gap-2 rounded-full bg-sky-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/25 transition-colors hover:bg-sky-500"
							>
								Get My API Key
								<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
							</TrackedLink>
							<TrackedLink
								href="/pricing"
								location="home_developers"
								cta="see_pricing"
								className="text-sm font-medium underline-offset-4 hover:underline"
							>
								See pricing
							</TrackedLink>
							<TrackedLink
								href="/enterprise#contact"
								location="home_developers"
								cta="contact_sales"
								className="text-sm font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
							>
								Rolling out company-wide? Talk to sales
							</TrackedLink>
						</div>
					</div>

					<div className="min-w-0 lg:col-span-7">
						<DeveloperSnippet />

						{migrations.length > 0 && (
							<div className="mt-8 flex flex-wrap items-center gap-2">
								<span className="mr-1 text-sm text-muted-foreground">
									Switching from
								</span>
								{migrations.map((m) => (
									<TrackedLink
										key={m.slug}
										href={`/migration/${m.slug}`}
										location="home_developers"
										cta={`migration_${m.slug}`}
										className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm transition-colors hover:border-foreground/30"
									>
										{m.fromProvider}
									</TrackedLink>
								))}
								<TrackedLink
									href="/migration"
									location="home_developers"
									cta="all_migrations"
									className="inline-flex items-center gap-0.5 px-2 text-sm text-muted-foreground hover:text-foreground"
								>
									All guides
									<ChevronRight className="size-3.5" />
								</TrackedLink>
							</div>
						)}
					</div>
				</div>

				<div className="mt-20 border-t border-border pt-10">
					<div className="flex flex-wrap items-baseline justify-between gap-4">
						<p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
							{MARKETING_STATS.providers} providers on the network
						</p>
						<TrackedLink
							href="/providers"
							location="home_developers"
							cta="all_providers"
							className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
						>
							View all providers
							<ChevronRight className="size-3.5" />
						</TrackedLink>
					</div>
					<ul className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4 lg:grid-cols-6">
						{CARRIERS.map((carrier) => (
							<li
								key={carrier.id}
								className="group flex flex-col items-center justify-center gap-4 bg-background px-3 py-7 transition-colors hover:bg-muted/40"
							>
								<span className="flex h-8 items-center">
									<ProviderLogo
										provider={carrier.id}
										className={cn(
											"w-auto max-w-[110px] object-contain",
											logoHeight(carrier.id),
										)}
									/>
								</span>
								<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors group-hover:text-foreground">
									{carrier.name}
								</span>
							</li>
						))}
					</ul>
				</div>
			</div>
		</section>
	);
}
