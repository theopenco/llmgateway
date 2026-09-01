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
	formatCompact,
	gateProviderStats,
	hasEnoughRequestsForStats,
	MIN_REQUESTS_FOR_STATS,
	type ProviderWindowStats,
} from "@/lib/provider-stats";
import { activeModelCounts, listedProviders } from "@/lib/providers-catalog";

import {
	countryCodeToFlag,
	getProviderCountries,
	isProviderCompliant,
	type ProviderCompliancePolicy,
	type ProviderId,
} from "@llmgateway/models";
import { CarrierMark, providerLogoUrls } from "@llmgateway/shared/components";

type SortKey = "fastest" | "slowest" | "popular" | "name" | "uptime";

const getProviderLogo = (providerId: ProviderId, uploadedLogo?: string) => {
	// A carrier-uploaded logo (Airside claim) wins over the built-in mark.
	if (uploadedLogo) {
		return (
			<div className="flex size-12 shrink-0 items-center justify-center overflow-hidden">
				<CarrierMark src={uploadedLogo} className="size-12 object-contain" />
			</div>
		);
	}
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

const PROVIDER_COUNTRIES = getProviderCountries();

type ComplianceFilterKey =
	| "requireSoc2"
	| "requireIso27001"
	| "requireGdpr"
	| "blockApiTraining"
	| "zeroDataRetention";

const COMPLIANCE_FILTERS: { key: ComplianceFilterKey; label: string }[] = [
	{ key: "requireSoc2", label: "SOC 2" },
	{ key: "requireIso27001", label: "ISO 27001" },
	{ key: "requireGdpr", label: "GDPR" },
	{ key: "blockApiTraining", label: "No training" },
	{ key: "zeroDataRetention", label: "ZDR" },
];

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

/** A DB-only provider (custom Airside carrier) appended to the static grid.
 *  Carries its own model count since the static counts don't know it, and no
 *  compliance metadata — so compliance/country filters exclude it. */
export interface ExtraGridProvider {
	id: string;
	name: string;
	description: string | null;
	modelsCount: number;
}

interface ProvidersGridProps {
	/** When set, only providers headquartered in this ISO 3166-1 alpha-2 code are shown. */
	countryCode?: string;
	/** Overrides the default page heading. */
	heading?: string;
	/** Overrides the default page subheading. */
	subheading?: string;
	/** providerId → uploaded logo data URL (Airside carrier branding). */
	uploadedLogos?: Record<string, string>;
	/** DB-only providers (custom Airside carriers) to list alongside the
	 *  static catalogue. */
	extraProviders?: ExtraGridProvider[];
}

type GridProvider = (typeof listedProviders)[number] | ExtraGridProvider;

function modelsCountOf(p: GridProvider): number {
	return "modelsCount" in p ? p.modelsCount : activeModelCounts[p.id] || 0;
}

export function ProvidersGrid({
	countryCode,
	heading,
	subheading,
	uploadedLogos,
	extraProviders,
}: ProvidersGridProps = {}) {
	const router = useRouter();
	const api = useApi();
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<SortKey>("popular");
	const [country, setCountry] = useState<string>("all");
	const [reqs, setReqs] = useState<Set<ComplianceFilterKey>>(new Set());

	const toggleReq = (key: ComplianceFilterKey) => {
		setReqs((prev) => {
			const next = new Set(prev);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	};

	const visibleProviders = useMemo<GridProvider[]>(() => {
		// Country pages only list catalogue providers — custom carriers carry
		// no headquarters metadata.
		if (countryCode) {
			return listedProviders.filter((p) => p.headquarters === countryCode);
		}
		return [...listedProviders, ...(extraProviders ?? [])];
	}, [countryCode, extraProviders]);

	const totalProviders = visibleProviders.length;
	const totalModels = visibleProviders.reduce(
		(sum, p) => sum + modelsCountOf(p),
		0,
	);

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
		const map = new Map<string, ProviderWindowStats>();
		if (statsData?.providers) {
			for (const row of statsData.providers) {
				map.set(
					row.providerId,
					gateProviderStats({
						logsCount: row.logsCount,
						uptime: row.uptime,
						avgTimeToFirstToken: row.avgTimeToFirstToken,
						timeToFirstTokenCount: row.timeToFirstTokenCount,
						throughput: row.throughput,
					}),
				);
			}
		}
		return map;
	}, [statsData]);

	const filteredAndSorted = useMemo(() => {
		const query = search.trim().toLowerCase();

		const enriched = visibleProviders.map((provider) => {
			const stats = statsByProvider.get(provider.id);
			return {
				...provider,
				stats,
				modelsCount: modelsCountOf(provider),
			};
		});

		const compliancePolicy: ProviderCompliancePolicy = { enabled: true };
		reqs.forEach((key) => {
			compliancePolicy[key] = true;
		});
		const activeCountry =
			countryCode ?? (country === "all" ? undefined : country);
		if (activeCountry) {
			compliancePolicy.allowedCountries = [activeCountry];
		}
		const complianceFiltered =
			reqs.size > 0 || activeCountry
				? enriched.filter((p) =>
						// Custom carriers carry no compliance metadata, so any active
						// requirement excludes them — matching how the helper treats a
						// missing dataPolicy.
						isProviderCompliant(
							p as Parameters<typeof isProviderCompliant>[0],
							compliancePolicy,
						),
					)
				: enriched;

		const filtered = query
			? complianceFiltered.filter(
					(p) =>
						p.name.toLowerCase().includes(query) ||
						p.id.toLowerCase().includes(query) ||
						(p.description?.toLowerCase().includes(query) ?? false),
				)
			: complianceFiltered;

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
	}, [
		search,
		sort,
		statsByProvider,
		visibleProviders,
		country,
		reqs,
		countryCode,
	]);

	return (
		<div className="container mx-auto px-4 pt-60 pb-8">
			<header className="text-center mb-12">
				<h1 className="text-4xl font-bold tracking-tight mb-4">
					{heading ?? "AI Providers"}
				</h1>
				<p className="text-xl text-muted-foreground mb-6 max-w-3xl mx-auto">
					{subheading ??
						`Access ${totalModels} models from ${totalProviders} leading AI providers through our unified API`}
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

			<div className="mb-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
				{!countryCode && (
					<div className="flex items-center gap-2">
						<span className="text-sm text-muted-foreground">Headquarters</span>
						<Select value={country} onValueChange={setCountry}>
							<SelectTrigger className="w-[190px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All countries</SelectItem>
								{PROVIDER_COUNTRIES.map((c) => (
									<SelectItem key={c.code} value={c.code}>
										{c.flag} {c.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm text-muted-foreground">Compliance</span>
					{COMPLIANCE_FILTERS.map((filter) => {
						const active = reqs.has(filter.key);
						return (
							<button
								key={filter.key}
								type="button"
								aria-pressed={active}
								onClick={() => toggleReq(filter.key)}
								className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
									active
										? "border-primary bg-primary/10 text-primary"
										: "border-border/60 text-muted-foreground hover:bg-muted"
								}`}
							>
								<ShieldCheck className="h-3.5 w-3.5" />
								{filter.label}
							</button>
						);
					})}
					{(reqs.size > 0 || country !== "all") && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setReqs(new Set());
								setCountry("all");
							}}
						>
							Clear
						</Button>
					)}
				</div>
			</div>

			{filteredAndSorted.length === 0 ? (
				<div className="rounded-xl border border-dashed py-16 text-center">
					<p className="text-muted-foreground">
						{search.trim()
							? `No providers match "${search}"`
							: "No providers match the selected filters"}
						. Try adjusting your search or filters.
					</p>
				</div>
			) : (
				<div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{filteredAndSorted.map((provider) => {
						// Static-catalogue-only card decorations; absent on custom
						// carriers appended via extraProviders.
						const headquarters =
							"headquarters" in provider ? provider.headquarters : undefined;
						const dataPolicy =
							"dataPolicy" in provider ? provider.dataPolicy : undefined;
						const website =
							"website" in provider ? provider.website : undefined;
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
										{getProviderLogo(
											provider.id as ProviderId,
											uploadedLogos?.[provider.id],
										)}
										<span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors group-hover:text-primary">
											View models
											<ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
										</span>
									</div>

									<div className="space-y-2">
										<div className="flex flex-wrap items-center gap-2">
											<CardTitle className="text-xl">{provider.name}</CardTitle>
										</div>
										<CardDescription className="line-clamp-2 leading-relaxed">
											{provider.description}
										</CardDescription>
									</div>

									{provider.stats &&
										!hasEnoughRequestsForStats(provider.stats.logsCount) && (
											<div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
												Stats hidden until{" "}
												{formatCompact(MIN_REQUESTS_FOR_STATS)} requests
											</div>
										)}

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
											{headquarters && (
												<Link
													href={`/providers/country/${headquarters.toLowerCase()}`}
													onClick={(e) => e.stopPropagation()}
													className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
												>
													<span className="leading-none">
														{countryCodeToFlag(headquarters)}
													</span>
													<MapPin className="h-3 w-3" />
													{headquarters}
												</Link>
											)}
											{dataPolicy?.apiTraining === false && (
												<span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
													<ShieldCheck className="h-3 w-3" />
													No training
												</span>
											)}
											{website && (
												<a
													href={website}
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
