"use client";

import {
	Activity,
	ArrowRight,
	ExternalLink,
	Gauge,
	MapPin,
	Plus,
	Search,
	ShieldCheck,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useApi } from "@/lib/fetch-client";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ProviderId,
} from "@llmgateway/models";
import { providerLogoUrls } from "@llmgateway/shared/components";

type SortKey = "fastest" | "slowest" | "popular" | "name" | "uptime";

const getProviderLogo = (providerId: ProviderId) => {
	const LogoComponent = providerLogoUrls[providerId];
	if (LogoComponent) {
		return (
			<div className="flex size-12 shrink-0 items-center justify-center overflow-hidden">
				<LogoComponent className="max-h-12 max-w-12 object-contain" />
			</div>
		);
	}
	return <div className="size-12 shrink-0 rounded-lg bg-muted" />;
};

const getModelsCountByProvider = (): Record<string, number> => {
	const counts: Record<string, number> = {};
	for (const model of modelDefinitions) {
		for (const providerMapping of model.providers) {
			const providerId = providerMapping.providerId;
			counts[providerId] = (counts[providerId] || 0) + 1;
		}
	}
	return counts;
};

const modelCounts = getModelsCountByProvider();

const baseProviders = providerDefinitions.filter(
	(p) => p.name !== "LLM Gateway" && p.id !== "custom",
);

const totalModels = modelDefinitions.length;
const totalProviders = baseProviders.length;

function formatTtft(ms: number | null | undefined): string {
	if (ms === null || ms === undefined) {
		return "—";
	}
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	return `${(ms / 1000).toFixed(2)}s`;
}

function formatUptime(pct: number | null | undefined): string {
	if (pct === null || pct === undefined) {
		return "—";
	}
	return `${pct.toFixed(2)}%`;
}

function speedBadge(ttft: number | null | undefined) {
	if (ttft === null || ttft === undefined) {
		return null;
	}
	if (ttft < 350) {
		return {
			label: "Blazing",
			className:
				"bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
			dot: "bg-emerald-500",
		};
	}
	if (ttft < 800) {
		return {
			label: "Fast",
			className: "bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/20",
			dot: "bg-sky-500",
		};
	}
	if (ttft < 1800) {
		return {
			label: "Steady",
			className:
				"bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20",
			dot: "bg-amber-500",
		};
	}
	return {
		label: "Patient",
		className:
			"bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20",
		dot: "bg-rose-500",
	};
}

export function ProvidersGrid() {
	const router = useRouter();
	const api = useApi();
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<SortKey>("popular");

	const { data: statsData } = api.useQuery(
		"get",
		"/public/providers/stats",
		{ params: { query: { window: "7d" as const } } },
		{
			refetchOnWindowFocus: false,
			staleTime: 5 * 60_000,
		},
	);

	const statsByProvider = useMemo(() => {
		const map = new Map<
			string,
			{
				uptime: number | null;
				avgTimeToFirstToken: number | null;
				throughput: number | null;
				logsCount: number;
			}
		>();
		if (statsData?.providers) {
			for (const row of statsData.providers) {
				map.set(row.providerId, {
					uptime: row.uptime,
					avgTimeToFirstToken: row.avgTimeToFirstToken,
					throughput: row.throughput,
					logsCount: row.logsCount,
				});
			}
		}
		return map;
	}, [statsData]);

	const filteredAndSorted = useMemo(() => {
		const query = search.trim().toLowerCase();

		const enriched = baseProviders.map((provider) => {
			const stats = statsByProvider.get(provider.id);
			return {
				...provider,
				stats,
				modelsCount: modelCounts[provider.id] || 0,
			};
		});

		const filtered = query
			? enriched.filter(
					(p) =>
						p.name.toLowerCase().includes(query) ||
						p.id.toLowerCase().includes(query) ||
						(p.description?.toLowerCase().includes(query) ?? false),
				)
			: enriched;

		const sortValue = (
			n: number | null | undefined,
			fallback: number,
		): number => (n === null || n === undefined ? fallback : n);

		switch (sort) {
			case "fastest":
				return [...filtered].sort(
					(a, b) =>
						sortValue(a.stats?.avgTimeToFirstToken, Number.POSITIVE_INFINITY) -
						sortValue(b.stats?.avgTimeToFirstToken, Number.POSITIVE_INFINITY),
				);
			case "slowest":
				return [...filtered].sort(
					(a, b) =>
						sortValue(b.stats?.avgTimeToFirstToken, -1) -
						sortValue(a.stats?.avgTimeToFirstToken, -1),
				);
			case "uptime":
				return [...filtered].sort(
					(a, b) =>
						sortValue(b.stats?.uptime, -1) - sortValue(a.stats?.uptime, -1),
				);
			case "name":
				return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
			case "popular":
			default:
				return [...filtered].sort((a, b) => b.modelsCount - a.modelsCount);
		}
	}, [search, sort, statsByProvider]);

	return (
		<div className="container mx-auto px-4 pt-60 pb-8">
			<header className="text-center mb-12">
				<h1 className="text-4xl font-bold tracking-tight mb-4">AI Providers</h1>
				<p className="text-xl text-muted-foreground mb-6 max-w-3xl mx-auto">
					Access {totalModels} models from {totalProviders} leading AI providers
					through our unified API
				</p>
				<div className="flex justify-center gap-8 text-sm text-muted-foreground">
					<div className="flex items-center gap-2">
						<div className="w-2 h-2 bg-green-500 rounded-full" />
						<span>{totalProviders} Providers</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="w-2 h-2 bg-blue-500 rounded-full" />
						<span>{totalModels} Models</span>
					</div>
					{statsData?.window && (
						<div className="flex items-center gap-2">
							<Zap className="h-3.5 w-3.5 text-amber-500" />
							<span>Stats from last {statsData.window}</span>
						</div>
					)}
				</div>
			</header>

			<div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="relative w-full sm:max-w-md">
					<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						type="search"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search providers by name or description"
						className="pl-9"
					/>
				</div>
				<div className="flex items-center gap-2">
					<Button asChild variant="outline">
						<Link href="/add-provider">
							<Plus className="h-4 w-4" />
							Add Provider
						</Link>
					</Button>
					<span className="text-sm text-muted-foreground hidden sm:inline">
						Sort by
					</span>
					<Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
						<SelectTrigger className="w-[180px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="popular">Most models</SelectItem>
							<SelectItem value="fastest">Fastest (TTFT)</SelectItem>
							<SelectItem value="slowest">Slowest (TTFT)</SelectItem>
							<SelectItem value="uptime">Highest uptime</SelectItem>
							<SelectItem value="name">Name (A–Z)</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			{filteredAndSorted.length === 0 ? (
				<div className="rounded-xl border border-dashed py-16 text-center">
					<p className="text-muted-foreground">
						No providers match "{search}". Try a different search term.
					</p>
				</div>
			) : (
				<div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{filteredAndSorted.map((provider) => {
						const badge = speedBadge(provider.stats?.avgTimeToFirstToken);
						return (
							<Card
								key={provider.id}
								className="group relative flex h-full cursor-pointer flex-col overflow-hidden border-border/60 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
								onClick={() => router.push(`/providers/${provider.id}`)}
							>
								<div
									aria-hidden
									className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/10 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
								/>
								<CardHeader className="flex flex-1 flex-col gap-4">
									<div className="flex items-start justify-between gap-3">
										{getProviderLogo(provider.id as ProviderId)}
										<span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors group-hover:text-primary">
											View models
											<ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
										</span>
									</div>

									<div className="space-y-2">
										<div className="flex flex-wrap items-center gap-2">
											<CardTitle className="text-xl">{provider.name}</CardTitle>
											{badge && (
												<span
													className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${badge.className}`}
												>
													<span
														className={`h-1.5 w-1.5 rounded-full ${badge.dot}`}
													/>
													{badge.label}
												</span>
											)}
										</div>
										<CardDescription className="line-clamp-2 leading-relaxed">
											{provider.description}
										</CardDescription>
									</div>

									{provider.stats &&
										(provider.stats.avgTimeToFirstToken !== null ||
											provider.stats.uptime !== null) && (
											<div className="grid grid-cols-2 divide-x divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-muted/30">
												<div className="flex items-center gap-2.5 p-3">
													<Gauge className="h-4 w-4 shrink-0 text-muted-foreground/70" />
													<div className="min-w-0">
														<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
															TTFT
														</div>
														<div className="font-mono text-sm font-semibold tabular-nums">
															{formatTtft(provider.stats.avgTimeToFirstToken)}
														</div>
													</div>
												</div>
												<div className="flex items-center gap-2.5 p-3">
													<Activity className="h-4 w-4 shrink-0 text-muted-foreground/70" />
													<div className="min-w-0">
														<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
															Uptime
														</div>
														<div className="font-mono text-sm font-semibold tabular-nums">
															{formatUptime(provider.stats.uptime)}
														</div>
													</div>
												</div>
											</div>
										)}

									<div className="mt-auto flex items-end justify-between gap-3 border-t border-border/60 pt-4">
										<div className="flex flex-col">
											<span className="text-lg font-semibold leading-none tabular-nums">
												{provider.modelsCount}
											</span>
											<span className="mt-1 text-xs text-muted-foreground">
												{provider.modelsCount === 1 ? "model" : "models"}
											</span>
										</div>
										<div className="flex flex-wrap items-center justify-end gap-1.5">
											{provider.headquarters && (
												<span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
													<MapPin className="h-3 w-3" />
													{provider.headquarters}
												</span>
											)}
											{provider.dataPolicy?.apiTraining === false && (
												<span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
													<ShieldCheck className="h-3 w-3" />
													No training
												</span>
											)}
											{provider.website && (
												<a
													href={provider.website}
													target="_blank"
													rel="noopener noreferrer"
													onClick={(e) => e.stopPropagation()}
													className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
												>
													<ExternalLink className="h-3 w-3" />
													Website
												</a>
											)}
										</div>
									</div>
								</CardHeader>
							</Card>
						);
					})}
				</div>
			)}
		</div>
	);
}
