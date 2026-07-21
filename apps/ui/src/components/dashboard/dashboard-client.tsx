"use client";

import { addDays, differenceInCalendarDays, format, subDays } from "date-fns";
import {
	CreditCard,
	Zap,
	Key,
	KeyRound,
	Activity,
	CircleDollarSign,
	BarChart3,
	ChartColumnBig,
	TrendingDown,
	ArrowDownToLine,
	ArrowUpFromLine,
	Server,
	Crown,
	ExternalLink,
	BookOpen,
	FlaskConical,
	MessageSquare,
	Settings,
	Wallet,
	Gift,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { TopUpCreditsButton } from "@/components/credits/top-up-credits-dialog";
import { CostBreakdownCard } from "@/components/dashboard/cost-breakdown-card";
import { ErrorsReliabilityCard } from "@/components/dashboard/errors-reliability-card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Overview } from "@/components/dashboard/overview";
import { RecentActivityCard } from "@/components/dashboard/recent-activity-card";
import { ReferralBanner } from "@/components/dashboard/referral-banner";
import {
	DateRangePicker,
	getDateRangeFromParams,
} from "@/components/date-range-picker";
import { QuickStartSection } from "@/components/shared/quick-start-snippet";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Skeleton } from "@/lib/components/skeleton";
import { useApi } from "@/lib/fetch-client";
import { getBrowserTimeZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";

import type { ActivitT } from "@/types/activity";

interface DashboardClientProps {
	initialActivityData?: ActivitT;
}

function formatCredits(credits: number) {
	return credits.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: credits !== 0 && Math.abs(credits) < 1 ? 4 : 2,
	});
}

function formatTokens(tokens: number) {
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M`;
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(1)}k`;
	}
	return tokens.toString();
}

function pctChange(current: number, previous: number): number | null {
	if (previous <= 0) {
		return null;
	}
	return ((current - previous) / previous) * 100;
}

const quickActions = [
	{
		href: "api-keys",
		icon: Key,
		label: "API Keys",
	},
	{
		href: "provider-keys",
		icon: KeyRound,
		label: "Provider Keys",
	},
	{
		href: "activity",
		icon: Activity,
		label: "Activity",
	},
	{
		href: "usage",
		icon: BarChart3,
		label: "Usage & Metrics",
	},
	{
		href: "model-usage",
		icon: ChartColumnBig,
		label: "Model Usage",
	},
	{
		href: "settings",
		icon: Settings,
		label: "Settings",
	},
] as const;

function QuickActionsCard({
	buildUrl,
	buildOrgUrl,
	className,
}: {
	buildUrl: (path?: string) => string;
	buildOrgUrl: (path?: string) => string;
	className?: string;
}) {
	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>Quick Actions</CardTitle>
				<CardDescription>Jump straight to common tasks</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="grid grid-cols-2 gap-2">
					{quickActions.map((action) => (
						<Link
							key={action.href}
							href={
								action.href === "provider-keys"
									? buildOrgUrl("org/provider-keys")
									: buildUrl(action.href)
							}
							prefetch={true}
							className="group flex items-center gap-3 rounded-lg border border-border/60 p-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
						>
							<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground transition-colors group-hover:text-foreground">
								<action.icon className="h-4 w-4" />
							</div>
							<span className="text-sm font-medium leading-tight">
								{action.label}
							</span>
						</Link>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

function StatCell({
	icon: Icon,
	label,
	value,
	sub,
	isLoading,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: string;
	sub?: string;
	isLoading?: boolean;
}) {
	return (
		<div className="min-w-0 lg:px-6 lg:first:pl-0 lg:last:pr-0">
			<div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				<Icon className="h-3.5 w-3.5" />
				<span className="truncate">{label}</span>
			</div>
			{isLoading ? (
				<Skeleton className="mt-2 h-6 w-20" />
			) : (
				<p className="mt-1.5 truncate text-lg font-semibold tabular-nums">
					{value}
				</p>
			)}
			{isLoading ? (
				<Skeleton className="mt-1.5 h-3 w-24" />
			) : sub ? (
				<p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
			) : null}
		</div>
	);
}

export function DashboardClient({ initialActivityData }: DashboardClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl, buildOrgUrl } = useDashboardNavigation();

	// Get date range from URL params
	const { from, to } = getDateRangeFromParams(searchParams);
	const fromStr = format(from, "yyyy-MM-dd");
	const toStr = format(to, "yyyy-MM-dd");

	const rangeDays = differenceInCalendarDays(to, from) + 1;
	const prevFrom = subDays(from, rangeDays);
	const prevTo = subDays(from, 1);

	// Get metric type from URL params, default to "costs"
	const metricParam = searchParams.get("metric");
	const metric = (metricParam === "requests" ? "requests" : "costs") as
		| "costs"
		| "requests";

	// If no from/to params exist, add them to the URL immediately
	useEffect(() => {
		if (!searchParams.get("from") || !searchParams.get("to")) {
			const params = new URLSearchParams(searchParams.toString());
			params.delete("days");
			const today = new Date();
			params.set("from", format(subDays(today, 6), "yyyy-MM-dd"));
			params.set("to", format(today, "yyyy-MM-dd"));
			router.replace(`${buildUrl()}?${params.toString()}`);
		}
	}, [searchParams, router, buildUrl]);

	const { selectedOrganization, selectedProject } = useDashboardNavigation();
	const api = useApi();

	const { data, isLoading } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					from: fromStr,
					to: toStr,
					timezone: getBrowserTimeZone(),
					...(selectedProject?.id ? { projectId: selectedProject.id } : {}),
				},
			},
		},
		{
			enabled: !!selectedProject?.id,
			initialData: searchParams.get("from") ? initialActivityData : undefined,
			refetchOnWindowFocus: false,
			staleTime: 1000 * 60 * 5, // 5 minutes
		},
	);

	// Previous period of the same length, used for trend deltas on the KPI
	// cards. Skipped for very long ranges (e.g. "All time") where a
	// comparison window is meaningless.
	const { data: prevData } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					from: format(prevFrom, "yyyy-MM-dd"),
					to: format(prevTo, "yyyy-MM-dd"),
					timezone: getBrowserTimeZone(),
					...(selectedProject?.id ? { projectId: selectedProject.id } : {}),
				},
			},
		},
		{
			enabled: !!selectedProject?.id && rangeDays <= 366,
			refetchOnWindowFocus: false,
			staleTime: 1000 * 60 * 5, // 5 minutes
		},
	);

	// Get API keys data to check plan limits
	const { data: apiKeysData } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: { projectId: selectedProject?.id ?? "" },
			},
		},
		{
			enabled: !!selectedProject?.id,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
		},
	);

	const planLimits = apiKeysData?.planLimits;

	// Function to update URL with new metric parameter
	const updateMetricInUrl = (newMetric: "costs" | "requests") => {
		const params = new URLSearchParams(searchParams.toString());
		params.set("metric", newMetric);
		router.push(`${buildUrl()}?${params.toString()}`);
	};

	const activityData = data?.activity ?? [];
	const prevActivityData = prevData?.activity ?? [];

	const totalRequests =
		activityData.reduce((sum, day) => sum + day.requestCount, 0) ?? 0;

	// Track when user reaches 50+ calls for invite banner eligibility
	useEffect(() => {
		if (totalRequests >= 50) {
			localStorage.setItem("user_has_50_plus_calls", "true");
		}
	}, [totalRequests]);
	const totalCost = activityData.reduce((sum, day) => sum + day.cost, 0) ?? 0;
	const totalInputCost =
		activityData.reduce((sum, day) => sum + day.inputCost, 0) ?? 0;
	const totalOutputCost =
		activityData.reduce((sum, day) => sum + day.outputCost, 0) ?? 0;
	const totalDataStorageCost =
		activityData.reduce((sum, day) => sum + day.dataStorageCost, 0) ?? 0;
	const totalRequestCost =
		activityData.reduce((sum, day) => sum + day.requestCost, 0) ?? 0;
	const totalSavings =
		activityData.reduce((sum, day) => sum + day.discountSavings, 0) ?? 0;
	const totalInputTokens =
		activityData.reduce((sum, day) => sum + day.inputTokens, 0) ?? 0;
	const totalOutputTokens =
		activityData.reduce((sum, day) => sum + day.outputTokens, 0) ?? 0;
	const totalCachedTokens =
		activityData.reduce((sum, day) => sum + day.cachedTokens, 0) ?? 0;
	const totalCachedInputCost =
		activityData.reduce((sum, day) => sum + day.cachedInputCost, 0) ?? 0;
	const totalErrors =
		activityData.reduce((sum, day) => sum + day.errorCount, 0) ?? 0;
	const totalCached =
		activityData.reduce((sum, day) => sum + day.cacheCount, 0) ?? 0;

	const prevRequests = prevActivityData.reduce(
		(sum, day) => sum + day.requestCount,
		0,
	);
	const prevCost = prevActivityData.reduce((sum, day) => sum + day.cost, 0);
	const prevSavings = prevActivityData.reduce(
		(sum, day) => sum + day.discountSavings,
		0,
	);

	const cacheHitRate =
		totalRequests > 0 ? (totalCached / totalRequests) * 100 : 0;
	const avgCostPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;

	// Day-by-day series for the KPI sparklines, with missing days filled as 0.
	const { requestsTrend, costTrend } = (() => {
		if (rangeDays > 400) {
			const sorted = [...activityData].sort((a, b) =>
				a.date < b.date ? -1 : 1,
			);
			return {
				requestsTrend: sorted.map((day) => day.requestCount),
				costTrend: sorted.map((day) => day.cost),
			};
		}
		const byDate = new Map(activityData.map((day) => [day.date, day]));
		const requests: number[] = [];
		const costs: number[] = [];
		for (let i = 0; i < rangeDays; i++) {
			const day = byDate.get(format(addDays(from, i), "yyyy-MM-dd"));
			requests.push(day?.requestCount ?? 0);
			costs.push(day?.cost ?? 0);
		}
		return { requestsTrend: requests, costTrend: costs };
	})();

	const { mostUsedModel, mostUsedProvider } = (() => {
		const modelCostMap = new Map<string, { cost: number; provider: string }>();
		for (const day of activityData) {
			for (const m of day.modelBreakdown) {
				const existing = modelCostMap.get(m.id);
				if (existing) {
					existing.cost += m.cost;
				} else {
					modelCostMap.set(m.id, { cost: m.cost, provider: m.provider });
				}
			}
		}
		let topModel = "";
		let topProvider = "";
		let topCost = 0;
		for (const [model, { cost, provider }] of Array.from(modelCostMap)) {
			if (cost > topCost) {
				topCost = cost;
				topModel = model;
				topProvider = provider;
			}
		}
		return { mostUsedModel: topModel, mostUsedProvider: topProvider };
	})();

	const isInitialLoading = !selectedOrganization;

	if (isInitialLoading) {
		return (
			<div className="flex flex-col">
				<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
					<div className="flex flex-col md:flex-row items-center justify-between space-y-2">
						<div>
							<h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
							<div className="h-5 w-48 bg-muted animate-pulse rounded mt-1" />
						</div>
					</div>
					<div className="space-y-4">
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
							{Array.from({ length: 4 }).map((_, i) => (
								<Card key={i}>
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<div className="h-4 w-24 bg-muted animate-pulse rounded" />
										<div className="h-4 w-4 bg-muted animate-pulse rounded" />
									</CardHeader>
									<CardContent>
										<div className="h-8 w-20 bg-muted animate-pulse rounded mb-2" />
										<div className="h-3 w-16 bg-muted animate-pulse rounded" />
									</CardContent>
								</Card>
							))}
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col md:flex-row items-center justify-between space-y-2">
					<div>
						<h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
						{selectedProject && (
							<p className="text-sm text-muted-foreground mt-1">
								Project: {selectedProject.name}
								{selectedOrganization && (
									<span className="ml-2">
										• Organization: {selectedOrganization.name}
									</span>
								)}
							</p>
						)}
					</div>
					<div className="flex items-center space-x-2">
						{selectedOrganization && selectedProject && (
							<>
								<CreateApiKeyDialog
									selectedProject={selectedProject}
									disabled={
										planLimits
											? planLimits.currentCount >= planLimits.maxKeys
											: false
									}
									disabledMessage={
										planLimits
											? `${planLimits.plan === "enterprise" ? "Enterprise" : planLimits.plan === "pro" ? "Pro" : "Free"} plan allows maximum ${planLimits.maxKeys} API keys per organization`
											: undefined
									}
								>
									<Button
										variant="outline"
										disabled={
											!selectedProject ||
											(planLimits
												? planLimits.currentCount >= planLimits.maxKeys
												: false)
										}
										className="flex items-center"
									>
										<Key className="mr-2 h-4 w-4" />
										Create API Key
									</Button>
								</CreateApiKeyDialog>
								<TopUpCreditsButton />
							</>
						)}
						{selectedOrganization && !selectedProject && <TopUpCreditsButton />}
					</div>
				</div>

				<ReferralBanner />

				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<DateRangePicker buildUrl={buildUrl} />
					{rangeDays <= 366 && (
						<p className="text-xs text-muted-foreground">
							Trends compare to {format(prevFrom, "MMM d")} –{" "}
							{format(prevTo, "MMM d")}
						</p>
					)}
				</div>

				<div className="space-y-4">
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
						<MetricCard
							label="Organization Credits"
							value={`$${
								selectedOrganization
									? formatCredits(Number(selectedOrganization.credits))
									: "0.00"
							}`}
							subtitle="Available balance"
							icon={<CreditCard className="h-4 w-4" />}
							accent="blue"
						/>
						<MetricCard
							label="Total Requests"
							value={totalRequests.toLocaleString()}
							subtitle={
								totalRequests > 0
									? `${cacheHitRate.toFixed(1)}% cache hit rate • ${totalErrors.toLocaleString()} errors`
									: `${format(from, "MMM d")} – ${format(to, "MMM d")}`
							}
							icon={<Zap className="h-4 w-4" />}
							accent="purple"
							delta={pctChange(totalRequests, prevRequests)}
							trend={requestsTrend}
							isLoading={isLoading}
						/>
						<MetricCard
							label="Total Spend"
							value={`$${totalCost.toFixed(2)}`}
							subtitle={
								totalRequests > 0
									? `avg $${avgCostPerRequest.toFixed(4)} per request${
											totalRequestCost > 0
												? ` • $${totalRequestCost.toFixed(2)} requests`
												: ""
										}${
											totalDataStorageCost > 0
												? ` • $${totalDataStorageCost.toFixed(4)} storage`
												: ""
										}`
									: `${format(from, "MMM d")} – ${format(to, "MMM d")}`
							}
							icon={<CircleDollarSign className="h-4 w-4" />}
							accent="blue"
							delta={pctChange(totalCost, prevCost)}
							trend={costTrend}
							isLoading={isLoading}
						/>
						<MetricCard
							label="Total Savings"
							value={`$${totalSavings.toFixed(4)}`}
							subtitle="Discounts this period"
							icon={<TrendingDown className="h-4 w-4" />}
							accent="green"
							delta={pctChange(totalSavings, prevSavings)}
							isLoading={isLoading}
						/>
					</div>

					<Card>
						<CardContent className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-border/60">
							<StatCell
								icon={ArrowDownToLine}
								label="Input tokens"
								value={formatTokens(totalInputTokens)}
								sub={`$${totalInputCost.toFixed(2)} spend`}
								isLoading={isLoading}
							/>
							<StatCell
								icon={ArrowUpFromLine}
								label="Output tokens"
								value={formatTokens(totalOutputTokens)}
								sub={`$${totalOutputCost.toFixed(2)} spend`}
								isLoading={isLoading}
							/>
							<StatCell
								icon={Server}
								label="Cached tokens"
								value={formatTokens(totalCachedTokens)}
								sub={`$${totalCachedInputCost.toFixed(2)} • included in input`}
								isLoading={isLoading}
							/>
							<StatCell
								icon={Crown}
								label="Top model"
								value={mostUsedModel || "—"}
								sub={
									mostUsedProvider ? `via ${mostUsedProvider}` : "No usage yet"
								}
								isLoading={isLoading}
							/>
						</CardContent>
					</Card>

					{!isLoading && totalRequests < 5 ? (
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
							{(() => {
								const credits = selectedOrganization
									? Number(selectedOrganization.credits)
									: 0;
								// Cohort-safe: only treat this as onboarding for orgs created
								// recently. An org with 0 credits and 0 recent requests may be
								// a returning user that has since run out — the date-windowed
								// totalRequests alone cannot distinguish them from a brand-new
								// org. Using createdAt avoids showing onboarding copy to
								// returning users.
								const createdAtMs = selectedOrganization?.createdAt
									? new Date(selectedOrganization.createdAt).getTime()
									: null;
								const isNewOrganization =
									createdAtMs !== null &&
									Date.now() - createdAtMs < 7 * 24 * 60 * 60 * 1000;
								const needsTopUp =
									!Number.isNaN(credits) &&
									credits <= 0 &&
									totalRequests === 0 &&
									isNewOrganization;

								if (needsTopUp) {
									return (
										<Card className="min-w-0 lg:col-span-4 border-primary/40 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
											<CardHeader>
												<div className="flex items-center gap-2">
													<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
														<Wallet className="h-4 w-4" />
													</div>
													<div>
														<CardTitle>
															Top up to start making requests
														</CardTitle>
														<CardDescription className="mt-1">
															Add credits to your organization to unlock all
															paid models. Free models are always available via
															the playground.
														</CardDescription>
													</div>
												</div>
											</CardHeader>
											<CardContent className="space-y-4">
												<div className="grid gap-3 sm:grid-cols-3">
													<div className="rounded-lg border border-border bg-background/60 p-3">
														<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
															<Zap className="h-3.5 w-3.5" />
															Pay as you go
														</div>
														<p className="mt-1 text-sm">
															Credits never expire. Only pay for what you use.
														</p>
													</div>
													<div className="rounded-lg border border-border bg-background/60 p-3">
														<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
															<Gift className="h-3.5 w-3.5" />
															Free models
														</div>
														<p className="mt-1 text-sm">
															Try{" "}
															<Link
																href="/models"
																className="underline hover:text-foreground"
																prefetch={true}
															>
																free models
															</Link>{" "}
															without topping up.
														</p>
													</div>
													<div className="rounded-lg border border-border bg-background/60 p-3">
														<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
															<CreditCard className="h-3.5 w-3.5" />
															Secure checkout
														</div>
														<p className="mt-1 text-sm">
															Powered by Stripe. Cancel or refund anytime.
														</p>
													</div>
												</div>
												<div className="flex flex-wrap gap-2">
													<TopUpCreditsButton />
													<Button asChild variant="outline" size="sm">
														<a
															href={
																process.env.NODE_ENV === "development"
																	? "http://localhost:3003"
																	: "https://chat.llmgateway.io"
															}
															target="_blank"
															rel="noopener noreferrer"
														>
															<FlaskConical className="mr-2 h-4 w-4" />
															Try free models
															<ExternalLink className="ml-1.5 h-3 w-3" />
														</a>
													</Button>
													<Button asChild variant="outline" size="sm">
														<a
															href="https://docs.llmgateway.io"
															target="_blank"
															rel="noopener noreferrer"
														>
															<BookOpen className="mr-2 h-4 w-4" />
															Docs
															<ExternalLink className="ml-1.5 h-3 w-3" />
														</a>
													</Button>
												</div>
											</CardContent>
										</Card>
									);
								}

								return (
									<Card className="min-w-0 lg:col-span-4">
										<CardHeader>
											<CardTitle>Get Started</CardTitle>
											<CardDescription>
												{totalRequests > 0
													? `You made ${totalRequests === 1 ? "your first call" : `${totalRequests} calls`} during setup! Now integrate LLM Gateway in your own code.`
													: "Integrate LLM Gateway in 1 line — just change your base URL."}
											</CardDescription>
										</CardHeader>
										<CardContent className="space-y-4">
											<QuickStartSection />
											<div className="flex flex-wrap gap-2">
												<Button asChild variant="outline" size="sm">
													<a
														href="https://docs.llmgateway.io"
														target="_blank"
														rel="noopener noreferrer"
													>
														<BookOpen className="mr-2 h-4 w-4" />
														Docs
														<ExternalLink className="ml-1.5 h-3 w-3" />
													</a>
												</Button>
												<Button asChild variant="outline" size="sm">
													<a
														href={
															process.env.NODE_ENV === "development"
																? "http://localhost:3003"
																: "https://chat.llmgateway.io"
														}
														target="_blank"
														rel="noopener noreferrer"
													>
														<FlaskConical className="mr-2 h-4 w-4" />
														Playground
														<ExternalLink className="ml-1.5 h-3 w-3" />
													</a>
												</Button>
												<Button asChild variant="outline" size="sm">
													<Link href="/models" prefetch={true}>
														<MessageSquare className="mr-2 h-4 w-4" />
														Models
													</Link>
												</Button>
											</div>
										</CardContent>
									</Card>
								);
							})()}
							<QuickActionsCard
								buildUrl={buildUrl}
								buildOrgUrl={buildOrgUrl}
								className="min-w-0 lg:col-span-3"
							/>
						</div>
					) : (
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
							<Card className="min-w-0 lg:col-span-4">
								<CardHeader>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<CardTitle>Usage Overview</CardTitle>
											<CardDescription>
												{metric === "costs"
													? "Daily inference spend (provider list price)"
													: "Daily request volume"}
											</CardDescription>
										</div>
										<div className="inline-flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5">
											{(["costs", "requests"] as const).map((option) => (
												<button
													key={option}
													type="button"
													onClick={() => updateMetricInUrl(option)}
													className={cn(
														"rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
														metric === option
															? "bg-background text-foreground shadow-sm"
															: "text-muted-foreground hover:text-foreground",
													)}
												>
													{option}
												</button>
											))}
										</div>
									</div>
								</CardHeader>
								<CardContent className="pl-2">
									<Overview
										data={activityData}
										isLoading={isLoading}
										metric={metric}
									/>
								</CardContent>
							</Card>
							<QuickActionsCard
								buildUrl={buildUrl}
								buildOrgUrl={buildOrgUrl}
								className="min-w-0 lg:col-span-3"
							/>
						</div>
					)}

					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
						<div className="min-w-0 lg:col-span-4 space-y-4">
							<CostBreakdownCard initialActivityData={initialActivityData} />
							<RecentActivityCard
								activityData={activityData}
								isLoading={isLoading}
							/>
						</div>
						<div className="min-w-0 lg:col-span-3">
							<ErrorsReliabilityCard
								activityData={activityData}
								isLoading={isLoading}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
