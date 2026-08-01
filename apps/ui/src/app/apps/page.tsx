import { ArrowRight } from "lucide-react";

import { AppsGrid } from "@/components/apps/apps-grid";
import { DevPassUpsell } from "@/components/apps/devpass-upsell";
import { AnimatedGroup } from "@/components/landing/animated-group";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { fetchServerData } from "@/lib/server-api";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Apps using LLM Gateway",
	description:
		"Browse coding agents and tools on LLM Gateway, ranked by tokens. Claude Code, Cursor, Cline, OpenCode, Aider, and more.",
	alternates: { canonical: "/apps" },
	openGraph: {
		title: "Apps using LLM Gateway",
		description:
			"Coding agents and tools running on LLM Gateway, ranked by tokens processed.",
		url: "https://llmgateway.io/apps",
		type: "website",
	},
};

export const revalidate = 300;

interface AppsResponse {
	apps: Array<{
		source: string;
		totalTokens: number;
		totalRequests: number;
		lastUsedAt: string | null;
	}>;
	totalApps: number;
	totalTokens: number;
	totalRequests: number;
}

const numberFormatter = new Intl.NumberFormat("en-US");

function formatBigNumber(n: number): string {
	if (n >= 1_000_000_000) {
		return `${(n / 1_000_000_000).toFixed(2)}B`;
	}
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(2)}M`;
	}
	if (n >= 1_000) {
		return `${(n / 1_000).toFixed(1)}K`;
	}
	return numberFormatter.format(n);
}

function HeroStat({
	value,
	label,
	accent,
}: {
	value: string;
	label: string;
	accent?: boolean;
}) {
	return (
		<div className="flex flex-col items-center gap-1">
			<span
				className={`font-display text-5xl md:text-6xl font-bold leading-none tracking-tighter tabular-nums ${
					accent ? "text-blue-500 dark:text-blue-400" : "text-foreground"
				}`}
			>
				{value}
			</span>
			<span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
				{label}
			</span>
		</div>
	);
}

export default async function AppsPage() {
	const data = await fetchServerData<AppsResponse>("GET", "/public/apps", {
		params: { query: { limit: "200" } },
	});

	const apps = data?.apps ?? [];
	const totalApps = data?.totalApps ?? apps.length;
	const totalTokens = data?.totalTokens ?? 0;
	const totalRequests = data?.totalRequests ?? 0;

	return (
		<div className="min-h-screen bg-background text-foreground">
			<main>
				<HeroRSC navbarOnly />

				<section className="relative overflow-hidden pt-36 md:pt-44 pb-12">
					<div
						aria-hidden
						className="pointer-events-none absolute left-1/2 top-32 -translate-x-1/2 w-[900px] h-[420px] bg-blue-500/[0.07] dark:bg-blue-500/[0.05] rounded-full blur-3xl"
					/>
					<div
						aria-hidden
						className="absolute inset-0 -z-10 size-full [background:radial-gradient(125%_125%_at_50%_100%,transparent_0%,var(--background)_75%)]"
					/>

					<div className="container relative mx-auto px-4">
						<AnimatedGroup
							preset="blur-slide"
							className="mx-auto max-w-4xl text-center"
						>
							<div className="mb-8 flex justify-center">
								<div className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur">
									<span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
									Live · refreshed every 5 minutes
								</div>
							</div>

							<h1 className="font-display text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-balance">
								Apps shipping with
								<br />
								<span className="text-muted-foreground">LLM Gateway</span>
							</h1>
							<p className="mx-auto mt-6 max-w-2xl text-balance text-base md:text-lg text-muted-foreground leading-relaxed">
								Real coding agents, real traffic. Every tool below routes
								through one API, ranked by tokens processed.
							</p>

							<div className="mt-14 flex flex-wrap items-center justify-center gap-x-12 md:gap-x-20 gap-y-8">
								<HeroStat
									value={numberFormatter.format(totalApps)}
									label="apps tracked"
								/>
								<span
									aria-hidden
									className="hidden h-14 w-px bg-border md:block"
								/>
								<HeroStat
									value={formatBigNumber(totalTokens)}
									label="tokens processed"
									accent
								/>
								<span
									aria-hidden
									className="hidden h-14 w-px bg-border md:block"
								/>
								<HeroStat
									value={formatBigNumber(totalRequests)}
									label="requests routed"
								/>
							</div>
						</AnimatedGroup>
					</div>
				</section>

				<div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />

				<section className="container mx-auto px-4 py-12 md:py-16">
					{apps.length > 0 ? (
						<>
							<div className="mb-8 flex flex-col items-start justify-between gap-3 rounded-xl border bg-card/40 px-5 py-4 sm:flex-row sm:items-center">
								<p className="text-sm text-muted-foreground">
									Want your app on this list? Set{" "}
									<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
										x-source: your-app.com
									</code>{" "}
									on requests to LLM Gateway.
								</p>
								<a
									href="/docs"
									className="group inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-blue-500"
								>
									Read the docs
									<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
								</a>
							</div>

							<AppsGrid apps={apps} />
						</>
					) : (
						<div className="rounded-2xl border border-dashed py-24 text-center">
							<p className="font-display text-lg font-semibold">
								No app traffic recorded yet
							</p>
							<p className="mt-1 text-sm text-muted-foreground">
								Once requests start flowing, apps will show up here ranked by
								tokens processed.
							</p>
						</div>
					)}
				</section>

				<DevPassUpsell />
			</main>
			<Footer />
		</div>
	);
}
