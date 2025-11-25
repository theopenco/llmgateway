"use client";

import {
	ArrowUpRight,
	CreditCard,
	Zap,
	Key,
	KeyRound,
	Activity,
	Coins,
	CircleDollarSign,
	BarChart3,
	ChartColumnBig,
	TrendingDown,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { TopUpCreditsButton } from "@/components/credits/top-up-credits-dialog";
import { Overview } from "@/components/dashboard/overview";
import { UpgradeToProDialog } from "@/components/shared/upgrade-to-pro-dialog";
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
import { Tabs, TabsList, TabsTrigger } from "@/lib/components/tabs";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { ActivitT } from "@/types/activity";

interface DashboardClientProps {
	initialActivityData?: ActivitT;
}

export function DashboardClient({ initialActivityData }: DashboardClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl } = useDashboardNavigation();

	// Get days from URL params, fallback to initialDays, then to 7
	const daysParam = searchParams.get("days");
	const days = (daysParam === "30" ? 30 : 7) as 7 | 30;

	// Get metric type from URL params, default to "costs"
	const metricParam = searchParams.get("metric");
	const metric = (metricParam === "requests" ? "requests" : "costs") as
		| "costs"
		| "requests";

	// If no days param exists, add it to the URL immediately
	useEffect(() => {
		if (!daysParam) {
			const params = new URLSearchParams(searchParams.toString());
			params.set("days", "7");
			router.replace(`${buildUrl()}?${params.toString()}`);
		}
	}, [daysParam, searchParams, router, buildUrl]);

	const { selectedOrganization, selectedProject } = useDashboardNavigation();
	const api = useApi();

	const { data, isLoading } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					days: String(days),
					...(selectedProject?.id ? { projectId: selectedProject.id } : {}),
				},
			},
		},
		{
			enabled: !!selectedProject?.id,
			// Only use initialData if days param is present (not defaulting)
			initialData: daysParam ? initialActivityData : undefined,
			refetchOnWindowFocus: false,
			staleTime: 1000 * 60 * 5, // 5 minutes
		},
	);

	// Function to update URL with new days parameter
	const updateDaysInUrl = (newDays: 7 | 30) => {
		const params = new URLSearchParams(searchParams.toString());
		params.set("days", String(newDays));
		router.push(`${buildUrl()}?${params.toString()}`);
	};

	// Function to update URL with new metric parameter
	const updateMetricInUrl = (newMetric: "costs" | "requests") => {
		const params = new URLSearchParams(searchParams.toString());
		params.set("metric", newMetric);
		router.push(`${buildUrl()}?${params.toString()}`);
	};

	const activityData = data?.activity || [];

	const totalRequests =
		activityData.reduce((sum, day) => sum + day.requestCount, 0) || 0;
	const totalTokens =
		activityData.reduce((sum, day) => sum + day.totalTokens, 0) || 0;
	const totalCost = activityData.reduce((sum, day) => sum + day.cost, 0) || 0;
	const totalInputCost =
		activityData.reduce((sum, day) => sum + day.inputCost, 0) || 0;
	const totalOutputCost =
		activityData.reduce((sum, day) => sum + day.outputCost, 0) || 0;
	const totalDataStorageCost =
		activityData.reduce((sum, day) => sum + day.dataStorageCost, 0) || 0;
	const totalRequestCost =
		activityData.reduce((sum, day) => sum + day.requestCost, 0) || 0;
	const totalSavings =
		activityData.reduce((sum, day) => sum + day.discountSavings, 0) || 0;

	const formatTokens = (tokens: number) => {
		if (tokens >= 1_000_000) {
			return `${(tokens / 1_000_000).toFixed(1)}M`;
		}
		if (tokens >= 1_000) {
			return `${(tokens / 1_000).toFixed(1)}k`;
		}
		return tokens.toString();
	};

	const isOrganizationLoading = !selectedOrganization;

	const shouldShowGetStartedState =
		!isLoading &&
		!isOrganizationLoading &&
		selectedOrganization &&
		selectedOrganization.credits === "0" &&
		selectedOrganization.plan !== "pro";

	const isInitialLoading = isOrganizationLoading;

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
						{selectedOrganization && <TopUpCreditsButton />}
					</div>
				</div>

				<Tabs
					value={days === 7 ? "7days" : "30days"}
					onValueChange={(value) => updateDaysInUrl(value === "7days" ? 7 : 30)}
					className="mb-2"
				>
					<TabsList>
						<TabsTrigger value="7days">Last 7 Days</TabsTrigger>
						<TabsTrigger value="30days">Last 30 Days</TabsTrigger>
					</TabsList>
				</Tabs>

				<div className="space-y-4">
					{shouldShowGetStartedState && (
						<div className="flex flex-col gap-3 py-12">
							<div className="flex items-center justify-center w-16 h-16 bg-muted rounded-full">
								<CreditCard className="w-8 h-8 text-muted-foreground" />
							</div>
							<div className="text-center">
								<h3 className="text-lg font-semibold mb-2">
									Welcome to LLM Gateway!
								</h3>
								<p className="text-muted-foreground mb-4">
									Get started by adding credits to your account or upgrading to
									Pro.
								</p>
								<div className="flex justify-center gap-2">
									{selectedOrganization && (
										<>
											<TopUpCreditsButton />
											<UpgradeToProDialog>
												<Button variant="outline">
													<ArrowUpRight className="mr-2 h-4 w-4" />
													Upgrade to Pro
												</Button>
											</UpgradeToProDialog>
										</>
									)}
								</div>
							</div>
						</div>
					)}

					<div
						className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-5", {
							"pointer-events-none opacity-20": shouldShowGetStartedState,
						})}
					>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">
									Organization Credits
								</CardTitle>
								<CreditCard className="text-muted-foreground h-4 w-4" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold truncate overflow-ellipsis">
									$
									{selectedOrganization
										? Number(selectedOrganization.credits).toFixed(8)
										: "0.00"}
								</div>
								<p className="text-muted-foreground text-xs">
									Available balance
								</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">
									Total Requests
								</CardTitle>
								<Zap className="text-muted-foreground h-4 w-4" />
							</CardHeader>
							<CardContent>
								{isLoading ? (
									<>
										<div className="text-2xl font-bold">Loading...</div>
										<p className="text-muted-foreground text-xs">–</p>
									</>
								) : (
									<>
										<div className="text-2xl font-bold">
											{totalRequests.toLocaleString()}
										</div>
										<p className="text-muted-foreground text-xs">
											Last {days} days
											{activityData.length > 0 && (
												<span className="ml-1">
													•{" "}
													{(
														activityData.reduce(
															(sum, day) => sum + day.cacheRate,
															0,
														) / activityData.length
													).toFixed(1)}
													% cached
												</span>
											)}
										</p>
									</>
								)}
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">
									Tokens Used
								</CardTitle>
								<Coins className="text-muted-foreground h-4 w-4" />
							</CardHeader>
							<CardContent>
								{isLoading ? (
									<>
										<div className="text-2xl font-bold">Loading...</div>
										<p className="text-muted-foreground text-xs">–</p>
									</>
								) : (
									<>
										<div className="text-2xl font-bold">
											{formatTokens(totalTokens)}
										</div>
										<p className="text-muted-foreground text-xs">
											Last {days} days
										</p>
									</>
								)}
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">
									Inference Cost
								</CardTitle>
								<CircleDollarSign className="text-muted-foreground h-4 w-4" />
							</CardHeader>
							<CardContent>
								{isLoading ? (
									<>
										<div className="text-2xl font-bold">Loading...</div>
										<p className="text-muted-foreground text-xs">–</p>
									</>
								) : (
									<>
										<div className="text-2xl font-bold">
											${totalCost.toFixed(2)}
										</div>
										<p className="text-muted-foreground text-xs">
											<span>${totalInputCost.toFixed(2)} input</span>
											&nbsp;+&nbsp;
											<span>${totalOutputCost.toFixed(2)} output</span>
											{totalRequestCost > 0 && (
												<>
													&nbsp;+&nbsp;
													<span>${totalRequestCost.toFixed(2)} requests</span>
												</>
											)}
										</p>
										{totalDataStorageCost > 0 && (
											<p className="text-muted-foreground text-xs mt-1 pt-1 border-t border-muted">
												<span className="text-xs">
													LLM Gateway: ${totalDataStorageCost.toFixed(4)}{" "}
													storage
												</span>
											</p>
										)}
									</>
								)}
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">
									Total Savings
								</CardTitle>
								<TrendingDown className="text-muted-foreground h-4 w-4" />
							</CardHeader>
							<CardContent>
								{isLoading ? (
									<>
										<div className="text-2xl font-bold">Loading...</div>
										<p className="text-muted-foreground text-xs">–</p>
									</>
								) : (
									<>
										<div className="text-2xl font-bold text-green-600">
											${totalSavings.toFixed(4)}
										</div>
										<p className="text-muted-foreground text-xs">
											From discounts in last {days} days
										</p>
									</>
								)}
							</CardContent>
						</Card>
					</div>
					<div
						className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-7", {
							"pointer-events-none opacity-20": shouldShowGetStartedState,
						})}
					>
						<Card className="col-span-4">
							<CardHeader>
								<div className="flex items-start justify-between">
									<div className="flex-1">
										<CardTitle>Usage Overview</CardTitle>
										<CardDescription>
											{metric === "costs" ? "Total Costs" : "Total Requests"}
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
									days={days}
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
								<Button
									asChild
									variant="outline"
									className="w-full justify-start"
								>
									<Link href={buildUrl("api-keys")} prefetch={true}>
										<Key className="mr-2 h-4 w-4" />
										Manage API Keys
									</Link>
								</Button>
								<Button
									asChild
									variant="outline"
									className="w-full justify-start"
								>
									<Link href={buildUrl("provider-keys")} prefetch={true}>
										<KeyRound className="mr-2 h-4 w-4" />
										Provider Keys
									</Link>
								</Button>
								<Button
									asChild
									variant="outline"
									className="w-full justify-start"
								>
									<Link href={buildUrl("activity")} prefetch={true}>
										<Activity className="mr-2 h-4 w-4" />
										View Activity
									</Link>
								</Button>
								<Button
									asChild
									variant="outline"
									className="w-full justify-start"
								>
									<Link href={buildUrl("usage")} prefetch={true}>
										<BarChart3 className="mr-2 h-4 w-4" />
										Usage & Metrics
									</Link>
								</Button>
								<Button
									asChild
									variant="outline"
									className="w-full justify-start"
								>
									<Link href={buildUrl("model-usage")} prefetch={true}>
										<ChartColumnBig className="mr-2 h-4 w-4" />
										Model Usage
									</Link>
								</Button>
							</CardContent>
						</Card>
					</div>
				</div>
			</div>
		</div>
	);
}
