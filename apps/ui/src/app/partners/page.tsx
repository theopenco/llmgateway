import {
	ArrowRight,
	ArrowUpRight,
	BarChart3,
	Globe2,
	Handshake,
	Leaf,
	MapPin,
	Plug,
	ShieldCheck,
	Zap,
} from "lucide-react";
import Link from "next/link";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { fetchServerData } from "@/lib/server-api";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";
import { MARKETING_STATS } from "@llmgateway/shared";
import {
	getModelFamilyIcon,
	isMappingDeactivated,
	ScxIcon,
} from "@llmgateway/shared/components";

import type { paths } from "@/lib/api/v1";
import type { Metadata } from "next";

export const revalidate = 300;

const BASE_URL = "https://llmgateway.io";

const title = "Partners — Infrastructure Behind LLM Gateway";
const description =
	"Meet the inference partners powering LLM Gateway, starting with launch partner SCX.ai — Australian sovereign AI serving open models from Sydney.";

export const metadata: Metadata = {
	title,
	description,
	alternates: { canonical: "/partners" },
	openGraph: {
		title,
		description,
		type: "website",
		url: `${BASE_URL}/partners`,
	},
	twitter: {
		card: "summary_large_image",
		title,
		description,
	},
};

const SCX_TURBO_ID = "scx-ai";
const SCX_GP_ID = "scx-ai-gp";
const SCX_PROVIDER_IDS: readonly string[] = [SCX_GP_ID, SCX_TURBO_ID];

const scxTurbo = providerDefinitions.find((p) => p.id === SCX_TURBO_ID);
const scxGp = providerDefinitions.find((p) => p.id === SCX_GP_ID);

interface ScxModelEntry {
	id: string;
	name: string;
	family: string;
	turbo: boolean;
	contextSize: number | null;
	inputPerM: string | null;
	outputPerM: string | null;
	releasedAt: number;
}

function formatPerMillion(perTokenPrice: string | undefined): string | null {
	if (!perTokenPrice) {
		return null;
	}
	const perMillion = Number.parseFloat(perTokenPrice) * 1_000_000;
	if (!Number.isFinite(perMillion)) {
		return null;
	}
	return `$${perMillion % 1 === 0 ? perMillion.toFixed(0) : perMillion.toFixed(2)}`;
}

const compactNumber = new Intl.NumberFormat("en", { notation: "compact" });

// Derived per render, not at module load: isMappingDeactivated() is
// time-based, so a mapping whose deactivatedAt passes must drop out on the
// next revalidation.
function getScxCatalog() {
	const scxModels: ScxModelEntry[] = (
		modelDefinitions as readonly ModelDefinition[]
	).flatMap((model) => {
		const mapping = model.providers.find(
			(p) =>
				SCX_PROVIDER_IDS.includes(p.providerId) && !isMappingDeactivated(p),
		);
		if (!mapping) {
			return [];
		}
		return [
			{
				id: model.id,
				name: model.name ?? model.id,
				family: model.family,
				turbo: mapping.providerId === SCX_TURBO_ID,
				contextSize: mapping.contextSize ?? null,
				inputPerM: formatPerMillion(mapping.inputPrice),
				outputPerM: formatPerMillion(mapping.outputPrice),
				releasedAt: model.releasedAt?.getTime() ?? 0,
			},
		];
	});

	const scxEndpoints = [
		{
			provider: scxGp,
			title: "General purpose",
			blurb:
				"Standard OpenAI-compatible inference for open models — the default SCX deployment.",
			modelCount: scxModels.filter((m) => !m.turbo).length,
		},
		{
			provider: scxTurbo,
			title: "Turbo",
			blurb:
				"SCX's accelerated deployment tier for latency-sensitive workloads, served from the same Sydney infrastructure.",
			modelCount: scxModels.filter((m) => m.turbo).length,
		},
	];

	return { scxModels, scxEndpoints };
}

const scxPolicy = scxTurbo?.dataPolicy;
const trustChips = [
	{ icon: Leaf, label: "Renewable-powered infrastructure" },
	scxPolicy?.apiTraining === false
		? { icon: ShieldCheck, label: "No training on API data" }
		: null,
	scxPolicy?.retentionPeriod === "0 days"
		? { icon: ShieldCheck, label: "Zero data retention" }
		: null,
	scxPolicy?.soc2
		? {
				icon: ShieldCheck,
				label: `SOC 2 Type ${scxPolicy.soc2 === 2 ? "II" : "I"}`,
			}
		: null,
	scxPolicy?.iso27001 ? { icon: ShieldCheck, label: "ISO 27001" } : null,
].filter((chip): chip is { icon: typeof Leaf; label: string } => chip !== null);

const partnerBenefits = [
	{
		icon: Globe2,
		title: "Distribution",
		blurb:
			"Your deployment is listed across the models directory, provider pages, and rankings — in front of every developer already routing through the gateway.",
	},
	{
		icon: Plug,
		title: "One integration",
		blurb:
			"An OpenAI-compatible endpoint is all it takes. Routing, failover, caching, and billing are handled by the gateway.",
	},
	{
		icon: BarChart3,
		title: "Transparent performance",
		blurb:
			"Uptime, time-to-first-token, and throughput are measured on real traffic and published live on your provider page.",
	},
];

// Positions echo the Crux constellation on the Australian flag.
const crossStars = [
	{ x: 96, y: 12, r: 7 },
	{ x: 40, y: 74, r: 6 },
	{ x: 88, y: 150, r: 8 },
	{ x: 148, y: 66, r: 6 },
	{ x: 118, y: 96, r: 3.5 },
];

function starPath(x: number, y: number, r: number): string {
	const inner = r / 4;
	return [
		`M${x} ${y - r}`,
		`L${x + inner} ${y - inner}`,
		`L${x + r} ${y}`,
		`L${x + inner} ${y + inner}`,
		`L${x} ${y + r}`,
		`L${x - inner} ${y + inner}`,
		`L${x - r} ${y}`,
		`L${x - inner} ${y - inner}`,
		"Z",
	].join(" ");
}

type PublicModelStats =
	paths["/public/models/stats"]["get"]["responses"][200]["content"]["application/json"];

export default async function PartnersPage() {
	const { scxModels, scxEndpoints } = getScxCatalog();
	// Server-side snapshot used to order the partner's models by real traffic;
	// the page degrades to release order when stats are unavailable.
	const stats = await fetchServerData<PublicModelStats>(
		"GET",
		"/public/models/stats",
		{ params: { query: { window: "30d" } } },
	);
	const tokensByModelId = new Map<string, number>(
		(stats?.models ?? []).map((m) => [m.modelId, m.totalTokens]),
	);
	const hasUsage = scxModels.some((m) => (tokensByModelId.get(m.id) ?? 0) > 0);
	const rankedModels = [...scxModels].sort((a, b) => {
		const usage =
			(tokensByModelId.get(b.id) ?? 0) - (tokensByModelId.get(a.id) ?? 0);
		return usage !== 0 ? usage : b.releasedAt - a.releasedAt;
	});
	const topModels = rankedModels.slice(0, 6);

	const collectionSchema = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		name: "LLM Gateway Partners",
		description,
		url: `${BASE_URL}/partners`,
		mainEntity: {
			"@type": "ItemList",
			numberOfItems: 1,
			itemListElement: [
				{
					"@type": "ListItem",
					position: 1,
					name: "SCX.ai",
					url: `${BASE_URL}/providers/${SCX_GP_ID}`,
				},
			],
		},
	};

	const organizationSchema = {
		"@context": "https://schema.org",
		"@type": "Organization",
		name: "SCX.ai",
		url: scxTurbo?.website ?? `${BASE_URL}/providers/${SCX_GP_ID}`,
		description: scxGp?.description,
		location: {
			"@type": "Place",
			address: {
				"@type": "PostalAddress",
				addressLocality: "Sydney",
				addressCountry: "AU",
			},
		},
	};

	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
			{
				"@type": "ListItem",
				position: 2,
				name: "Partners",
				item: `${BASE_URL}/partners`,
			},
		],
	};

	return (
		<>
			<JsonLd data={[collectionSchema, organizationSchema, breadcrumbSchema]} />

			<Navbar />

			<main className="relative min-h-screen overflow-hidden bg-background pt-20 md:pt-24">
				<div
					aria-hidden
					className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(16,185,129,0.10)_0%,transparent_70%)]"
				/>

				{/* Hero */}
				<section className="border-b border-border/60">
					<div className="container mx-auto px-4 py-12 md:py-16">
						<div className="mx-auto max-w-3xl space-y-5 text-center">
							<Badge
								variant="outline"
								className="gap-1.5 rounded-full px-3 py-1 text-xs"
							>
								<Handshake className="h-3.5 w-3.5 text-emerald-500" />
								Partners
							</Badge>
							<h1 className="font-display text-3xl font-bold tracking-tight text-balance md:text-5xl">
								The infrastructure behind the gateway
							</h1>
							<p className="mx-auto max-w-2xl text-balance text-sm text-muted-foreground md:text-base">
								LLM Gateway routes one OpenAI-compatible API across{" "}
								{MARKETING_STATS.providers} providers and{" "}
								{MARKETING_STATS.models} models. Partners are the inference
								platforms running that capacity — integrated, measured on real
								traffic, and billed through a single endpoint.
							</p>

							<ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 pt-2 text-sm">
								<li className="flex items-baseline gap-1.5">
									<span className="font-display text-xl font-bold tabular-nums text-foreground">
										{MARKETING_STATS.providers}
									</span>
									<span className="text-muted-foreground">providers</span>
								</li>
								<li className="flex items-baseline gap-1.5 before:mr-6 before:text-border before:content-['•']">
									<span className="font-display text-xl font-bold tabular-nums text-foreground">
										{MARKETING_STATS.models}
									</span>
									<span className="text-muted-foreground">models</span>
								</li>
								<li className="flex items-baseline gap-1.5 before:mr-6 before:text-border before:content-['•']">
									<span className="font-display text-xl font-bold tabular-nums text-foreground">
										{MARKETING_STATS.tokensRouted}
									</span>
									<span className="text-muted-foreground">tokens routed</span>
								</li>
								<li className="flex items-baseline gap-1.5 before:mr-6 before:text-border before:content-['•']">
									<span className="font-display text-xl font-bold tabular-nums text-foreground">
										{MARKETING_STATS.uptimeSla}
									</span>
									<span className="text-muted-foreground">uptime SLA</span>
								</li>
							</ul>
						</div>
					</div>
				</section>

				{/* Featured partner */}
				<section className="border-b border-border/60">
					<div className="container mx-auto px-4 py-14 md:py-20">
						<div className="mx-auto mb-8 max-w-3xl space-y-3 text-center">
							<h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
								Launch partner
							</h2>
							<p className="text-sm text-muted-foreground md:text-base">
								The first partner in the program, serving open models to the
								gateway from Australia.
							</p>
						</div>

						<div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#1a1a2e] text-white">
							<div
								aria-hidden
								className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_85%_0%,rgba(45,212,191,0.14)_0%,transparent_60%),radial-gradient(60%_50%_at_0%_100%,rgba(251,191,36,0.08)_0%,transparent_55%)]"
							/>
							{/* Southern Cross, as on the Australian flag */}
							<svg
								aria-hidden
								viewBox="0 0 200 200"
								className="pointer-events-none absolute right-6 top-6 h-40 w-40 text-white/25 md:right-12 md:top-10"
							>
								{crossStars.map((star) => (
									<path
										key={`${star.x}-${star.y}`}
										fill="currentColor"
										d={starPath(star.x, star.y, star.r)}
									/>
								))}
							</svg>

							<div className="relative grid gap-10 p-8 md:p-12 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
								<div className="space-y-6">
									<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-teal-300/90">
										<MapPin className="h-3.5 w-3.5" />
										Sydney, Australia
									</div>

									<ScxIcon className="h-10 w-auto text-white md:h-12" />

									<p className="max-w-xl text-sm leading-relaxed text-white/70 md:text-base">
										SCX.ai is an Australian sovereign AI platform serving open
										models from renewable-powered infrastructure. It routes
										through LLM Gateway as two OpenAI-compatible deployments — a
										general-purpose endpoint and a Turbo endpoint{" "}
										{scxTurbo?.modelCardBadge
											? `rated "${scxTurbo.modelCardBadge.toLowerCase()}"`
											: "built for latency-sensitive workloads"}{" "}
										— giving teams in the region local inference without leaving
										the gateway API.
									</p>

									<ul className="flex flex-wrap gap-2">
										{trustChips.map((chip) => (
											<li
												key={chip.label}
												className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80"
											>
												<chip.icon className="h-3 w-3 text-teal-300" />
												{chip.label}
											</li>
										))}
									</ul>

									{scxTurbo?.website ? (
										<a
											href={scxTurbo.website}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-300 transition-colors hover:text-teal-200"
										>
											scx.ai
											<ArrowUpRight className="h-3.5 w-3.5" />
										</a>
									) : null}
								</div>

								<div className="flex flex-col justify-center gap-4">
									{scxEndpoints.map((endpoint) =>
										endpoint.provider ? (
											<Link
												key={endpoint.provider.id}
												href={`/providers/${endpoint.provider.id}`}
												className="group rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-colors hover:border-white/25 hover:bg-white/[0.08]"
											>
												<div className="flex items-center justify-between gap-3">
													<span className="font-display text-base font-semibold">
														{endpoint.provider.name}
													</span>
													{endpoint.title === "Turbo" &&
													scxTurbo?.modelCardBadge ? (
														<span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
															<Zap className="h-3 w-3" />
															{scxTurbo.modelCardBadge}
														</span>
													) : null}
												</div>
												<p className="mt-2 text-sm text-white/60">
													{endpoint.blurb}
												</p>
												<div className="mt-4 flex items-center justify-between text-sm">
													<span className="tabular-nums text-white/70">
														{endpoint.modelCount}{" "}
														{endpoint.modelCount === 1 ? "model" : "models"}
													</span>
													<span className="inline-flex items-center gap-1 font-medium text-teal-300 transition-transform group-hover:translate-x-0.5">
														View endpoint
														<ArrowRight className="h-3.5 w-3.5" />
													</span>
												</div>
											</Link>
										) : null,
									)}
								</div>
							</div>
						</div>
					</div>
				</section>

				{/* Models served by the partner */}
				<section className="border-b border-border/60">
					<div className="container mx-auto px-4 py-14 md:py-20">
						<div className="mx-auto mb-8 max-w-3xl space-y-3 text-center">
							<h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
								Most-used models on SCX
							</h2>
							<p className="text-sm text-muted-foreground md:text-base">
								{hasUsage
									? "Ordered by token volume routed through the gateway over the last 30 days."
									: "The open models currently served through SCX's endpoints, newest first."}
							</p>
						</div>

						<div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{topModels.map((model, index) => {
								const FamilyIcon = getModelFamilyIcon(model.family);
								const tokens = tokensByModelId.get(model.id) ?? 0;
								return (
									<Link
										key={model.id}
										href={`/models/${encodeURIComponent(model.id)}`}
										className="group flex flex-col rounded-2xl border border-border/60 bg-card p-5 transition-colors hover:border-foreground/20"
									>
										<div className="flex items-center gap-3">
											<span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted/40">
												<FamilyIcon className="max-h-5 max-w-5 object-contain" />
											</span>
											<span className="font-display text-sm font-semibold leading-tight">
												{model.name}
											</span>
											<span className="ml-auto font-display text-xs font-bold tabular-nums text-muted-foreground/60">
												#{index + 1}
											</span>
										</div>

										<div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
											{model.turbo ? (
												<span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
													<Zap className="h-3 w-3" />
													Turbo
												</span>
											) : (
												<span>General purpose</span>
											)}
											{model.contextSize ? (
												<span className="tabular-nums">
													{compactNumber.format(model.contextSize)} context
												</span>
											) : null}
										</div>

										<div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-xs">
											<span className="tabular-nums text-muted-foreground">
												{model.inputPerM && model.outputPerM
													? `${model.inputPerM} in · ${model.outputPerM} out /M`
													: "See pricing"}
											</span>
											{hasUsage && tokens > 0 ? (
												<span className="tabular-nums text-muted-foreground/70">
													{compactNumber.format(tokens)} tokens
												</span>
											) : null}
										</div>
									</Link>
								);
							})}
						</div>

						<div className="mt-8 text-center">
							<Link
								href={`/providers/${SCX_GP_ID}`}
								className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
							>
								All {scxModels.length} SCX models
								<ArrowRight className="h-3.5 w-3.5" />
							</Link>
						</div>
					</div>
				</section>

				{/* Become a partner */}
				<section>
					<div className="container mx-auto px-4 py-14 md:py-20">
						<div className="mx-auto mb-10 max-w-3xl space-y-3 text-center">
							<h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
								Run your models on LLM Gateway
							</h2>
							<p className="text-sm text-muted-foreground md:text-base">
								Inference providers join the catalogue with one integration and
								get measured the same way as everyone else.
							</p>
						</div>

						<div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-3">
							{partnerBenefits.map((benefit) => (
								<div
									key={benefit.title}
									className="rounded-2xl border border-border/60 bg-muted/30 p-5"
								>
									<benefit.icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
									<h3 className="mt-3 font-display text-sm font-semibold">
										{benefit.title}
									</h3>
									<p className="mt-1.5 text-sm text-muted-foreground">
										{benefit.blurb}
									</p>
								</div>
							))}
						</div>

						<div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
							<Button asChild size="lg" className="rounded-xl">
								<Link href="/add-provider">
									List your provider
									<ArrowRight className="ml-1.5 h-4 w-4" />
								</Link>
							</Button>
							<Button asChild size="lg" variant="ghost" className="rounded-xl">
								<Link href="/providers">Browse all providers</Link>
							</Button>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</>
	);
}
