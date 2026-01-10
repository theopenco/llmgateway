"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { CacheRateChart } from "@/components/usage/cache-rate-chart";
import { CostBreakdownChart } from "@/components/usage/cost-breakdown-chart";
import { ErrorRateChart } from "@/components/usage/error-rate-chart";
import { ModelUsageTable } from "@/components/usage/model-usage-table";
import { UsageChart } from "@/components/usage/usage-chart";
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
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/lib/components/tabs";
import { useApi } from "@/lib/fetch-client";

import type { ActivitT } from "@/types/activity";

interface UsageClientProps {
	initialActivityData?: ActivitT;
	projectId: string | undefined;
}

export function UsageClient({
	initialActivityData,
	projectId,
}: UsageClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl } = useDashboardNavigation();
	const api = useApi();

	// Fetch API keys for the project
	const { data: apiKeysData } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: {
					projectId: projectId || "",
				},
			},
		},
		{
			enabled: !!projectId,
		},
	);

	const apiKeys =
		apiKeysData?.apiKeys.filter((key) => key.status !== "deleted") || [];

	// Check if days parameter exists in URL
	const daysParam = searchParams.get("days");
	const days = daysParam === "30" ? 30 : 7;

	// Get apiKeyId from URL
	const apiKeyId = searchParams.get("apiKeyId") || undefined;

	// If no days parameter, redirect to add days=7
	useEffect(() => {
		if (!daysParam) {
			const params = new URLSearchParams(searchParams);
			params.set("days", "7");
			router.replace(`${buildUrl("usage")}?${params.toString()}`);
		}
	}, [daysParam, router, searchParams, buildUrl]);

	// Function to update days in URL
	const updateDaysInUrl = (newDays: 7 | 30) => {
		const params = new URLSearchParams(searchParams);
		params.set("days", String(newDays));
		router.push(`${buildUrl("usage")}?${params.toString()}`);
	};

	// Function to update apiKeyId in URL
	const updateApiKeyIdInUrl = (newApiKeyId: string | undefined) => {
		const params = new URLSearchParams(searchParams);
		if (newApiKeyId) {
			params.set("apiKeyId", newApiKeyId);
		} else {
			params.delete("apiKeyId");
		}
		router.push(`${buildUrl("usage")}?${params.toString()}`);
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-3xl font-bold tracking-tight">Usage & Metrics</h2>
					<div className="flex items-center space-x-2">
						<Select
							value={apiKeyId || "all"}
							onValueChange={(value) =>
								updateApiKeyIdInUrl(value === "all" ? undefined : value)
							}
						>
							<SelectTrigger size="sm" className="w-[180px]">
								<SelectValue placeholder="All API Keys" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All API Keys</SelectItem>
								{apiKeys.map((key) => (
									<SelectItem key={key.id} value={key.id}>
										{key.description}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							variant={days === 7 ? "default" : "outline"}
							size="sm"
							onClick={() => updateDaysInUrl(7)}
						>
							7 Days
						</Button>
						<Button
							variant={days === 30 ? "default" : "outline"}
							size="sm"
							onClick={() => updateDaysInUrl(30)}
						>
							30 Days
						</Button>
					</div>
				</div>
				<Tabs defaultValue="requests" className="space-y-4">
					<TabsList>
						<TabsTrigger value="requests">Requests</TabsTrigger>
						<TabsTrigger value="models">Models</TabsTrigger>
						<TabsTrigger value="errors">Errors</TabsTrigger>
						<TabsTrigger value="cache">Cache</TabsTrigger>
						<TabsTrigger value="costs">Costs</TabsTrigger>
					</TabsList>
					<TabsContent value="requests" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Request Volume</CardTitle>
								<CardDescription>
									Number of API requests over time
								</CardDescription>
							</CardHeader>
							<CardContent className="h-[400px]">
								<UsageChart
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="models" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Top Used Models</CardTitle>
								<CardDescription>Usage breakdown by model</CardDescription>
							</CardHeader>
							<CardContent>
								<ModelUsageTable
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="errors" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Error Rate</CardTitle>
								<CardDescription>
									API request error rate over time
								</CardDescription>
							</CardHeader>
							<CardContent className="h-[400px]">
								<ErrorRateChart
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="cache" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Cache Rate</CardTitle>
								<CardDescription>
									API request cache rate over time
								</CardDescription>
							</CardHeader>
							<CardContent className="h-[400px]">
								<CacheRateChart
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="costs" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Cost Breakdown</CardTitle>
								<CardDescription>
									Estimated costs by provider and model
								</CardDescription>
							</CardHeader>
							<CardContent className="h-[400px]">
								<CostBreakdownChart
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
