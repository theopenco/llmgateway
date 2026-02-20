"use client";

import { format, subDays } from "date-fns";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useApi } from "@/lib/fetch-client";

import type { ActivitT } from "@/types/activity";

interface DashboardClientProps {
	initialActivityData?: ActivitT;
}

export function DashboardClient({ initialActivityData }: DashboardClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl, buildOrgUrl } = useDashboardNavigation();

	// Get date range from URL params
	const { from, to } = getDateRangeFromParams(searchParams);
	const fromStr = format(from, "yyyy-MM-dd");
	const toStr = format(to, "yyyy-MM-dd");

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

	const quickActions = [
		{
			href: "api-keys",
			icon: Key,
			label: "Manage API Keys",
		},
		{
			href: "provider-keys",
			icon: KeyRound,
			label: "Provider Keys",
		},
		{
			href: "activity",
			icon: Activity,
			label: "View Activity",
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
	] as const;

	const formatTokens = (tokens: number) => {
		if (tokens >= 1_000_000) {
			return `${(tokens / 1_000_000).toFixed(1)}M`;
		}
		if (tokens >= 1_000) {
			return `${(tokens / 1_000).toFixed(1)}k`;
		}
		return tokens.toString();
	};

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
											? `${planLimits.plan === "pro" ? "Pro" : "Free"} plan allows maximum ${planLimits.maxKeys} API keys per project`
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

				<DateRangePicker buildUrl={buildUrl} />

				<div className="space-y-4">
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
						<MetricCard
							label="Organization Credits"
							value={`$${
								selectedOrganization
									? Number(selectedOrganization.credits).toFixed(8)
									: "0.00"
							}`}
							subtitle="Available balance"
							icon={<CreditCard className="h-4 w-4" />}
							accent="blue"
						/>
						<MetricCard
							label="Total Requests"
							value={isLoading ? "Loading..." : totalRequests.toLocaleString()}
							subtitle={
								isLoading
									? "–"
									: `${format(from, "MMM d")} - ${format(to, "MMM d")}${
											activityData.length > 0
												? ` • ${(
														activityData.reduce(
															(sum, day) => sum + day.cacheRate,
															0,
														) / activityData.length
													).toFixed(1)}% cached`
												: ""
										}`
							}
							icon={<Zap className="h-4 w-4" />}
							accent="purple"
						/>
						<MetricCard
							label="Total Cost"
							value={isLoading ? "Loading..." : `$${totalCost.toFixed(2)}`}
							subtitle={
								isLoading
									? "–"
									: `${format(from, "MMM d")} - ${format(to, "MMM d")}${
											totalRequestCost > 0
												? ` • $${totalRequestCost.toFixed(2)} requests`
												: ""
										}${
											totalDataStorageCost > 0
												? ` • $${totalDataStorageCost.toFixed(4)} storage`
												: ""
										}`
							}
							icon={<CircleDollarSign className="h-4 w-4" />}
							accent="purple"
						/>
						<MetricCard
							label="Total Savings"
							value={isLoading ? "Loading..." : `$${totalSavings.toFixed(4)}`}
							subtitle={
								isLoading
									? "–"
									: `Discounts from ${format(from, "MMM d")} - ${format(to, "MMM d")}`
							}
							icon={<TrendingDown className="h-4 w-4" />}
							accent="green"
						/>
						<MetricCard
							label="Input Tokens & Cost"
							value={
								isLoading
									? "Loading..."
									: `${formatTokens(totalInputTokens)} • $${totalInputCost.toFixed(2)}`
							}
							subtitle={isLoading ? "–" : "Prompt tokens and associated cost"}
							icon={<ArrowDownToLine className="h-4 w-4" />}
							accent="blue"
						/>
						<MetricCard
							label="Output Tokens & Cost"
							value={
								isLoading
									? "Loading..."
									: `${formatTokens(totalOutputTokens)} • $${totalOutputCost.toFixed(2)}`
							}
							subtitle={
								isLoading ? "–" : "Completion tokens and associated cost"
							}
							icon={<ArrowUpFromLine className="h-4 w-4" />}
							accent="purple"
						/>
						<MetricCard
							label="Cached Tokens & Cost"
							value={
								isLoading
									? "Loading..."
									: `${formatTokens(totalCachedTokens)} • $${totalCachedInputCost.toFixed(2)}`
							}
							subtitle={
								isLoading
									? "–"
									: "Tokens and cost served from cache (if supported)"
							}
							icon={<Server className="h-4 w-4" />}
							accent="green"
						/>
						<MetricCard
							label="Most Used Model"
							value={isLoading ? "Loading..." : mostUsedModel || "—"}
							subtitle={
								isLoading
									? "–"
									: mostUsedProvider
										? `Provider: ${mostUsedProvider}`
										: `${format(from, "MMM d")} - ${format(to, "MMM d")}`
							}
							icon={<Crown className="h-4 w-4" />}
							accent="blue"
						/>
					</div>
					{!isLoading && totalRequests < 5 ? (
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
							<Card className="col-span-4">
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
							<Card className="col-span-3">
								<CardHeader>
									<CardTitle>Quick Actions</CardTitle>
									<CardDescription>
										Common tasks you might want to perform
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-2">
									{quickActions.map((action) => (
										<Button
											key={action.href}
											asChild
											variant="outline"
											className="w-full justify-start"
										>
											<Link
												href={
													action.href === "provider-keys"
														? buildOrgUrl("org/provider-keys")
														: buildUrl(action.href)
												}
												prefetch={true}
											>
												<action.icon className="mr-2 h-4 w-4" />
												{action.label}
											</Link>
										</Button>
									))}
								</CardContent>
							</Card>
						</div>
					) : (
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
							<Card className="col-span-4">
								<CardHeader>
									<div className="flex items-start justify-between">
										<div className="flex-1">
											<CardTitle>Usage Overview</CardTitle>
											<CardDescription>
												{metric === "costs"
													? "Provider pricing for reference"
													: "Total Requests"}
												{selectedProject && (
													<span className="block mt-1 text-sm">
														Filtered by project: {selectedProject.name}
													</span>
												)}
											</CardDescription>
										</div>
										<Select value={metric} onValueChange={updateMetricInUrl}>
											<SelectTrigger className="w-[140px]">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="costs">Costs</SelectItem>
												<SelectItem value="requests">Requests</SelectItem>
											</SelectContent>
										</Select>
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
							<Card className="col-span-3">
								<CardHeader>
									<CardTitle>Quick Actions</CardTitle>
									<CardDescription>
										Common tasks you might want to perform
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-2">
									{quickActions.map((action) => (
										<Button
											key={action.href}
											asChild
											variant="outline"
											className="w-full justify-start"
										>
											<Link
												href={
													action.href === "provider-keys"
														? buildOrgUrl("org/provider-keys")
														: buildUrl(action.href)
												}
												prefetch={true}
											>
												<action.icon className="mr-2 h-4 w-4" />
												{action.label}
											</Link>
										</Button>
									))}
								</CardContent>
							</Card>
						</div>
					)}

					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
						<div className="col-span-4 space-y-4">
							<CostBreakdownCard initialActivityData={initialActivityData} />
							<RecentActivityCard
								activityData={activityData}
								isLoading={isLoading}
							/>
						</div>
						<div className="col-span-3">
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
