"use client";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useApi } from "@/lib/fetch-client";

import { providers } from "@llmgateway/models";

import type { ActivitT } from "@/types/activity";
import type { TooltipProps } from "recharts";

interface CostBreakdownChartProps {
	initialData?: ActivitT;
	projectId?: string;
	apiKeyId?: string;
}

const CustomTooltip = ({
	active,
	payload,
	label,
}: TooltipProps<number, string> & {
	payload: { value: number }[];
	label: string;
}) => {
	if (active && payload && payload.length) {
		return (
			<div className="rounded-lg border bg-popover text-popover-foreground p-2 shadow-sm">
				<p className="font-medium">{label}</p>
				<p className="text-sm">
					<span className="font-medium">
						${Number(payload[0].value).toFixed(4)}
					</span>{" "}
					Cost
				</p>
			</div>
		);
	}
	return null;
};

export function CostBreakdownChart({
	initialData,
	projectId,
	apiKeyId,
}: CostBreakdownChartProps) {
	const searchParams = useSearchParams();
	const { selectedProject } = useDashboardNavigation();
	const [showAllSegments, setShowAllSegments] = useState(false);

	// Get days from URL parameter
	const daysParam = searchParams.get("days");
	const days = daysParam === "30" ? 30 : 7;

	// Use provided projectId or fall back to selectedProject
	const effectiveProjectId = projectId || selectedProject?.id;

	const api = useApi();
	const { data, isLoading, error } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					days: String(days),
					...(effectiveProjectId ? { projectId: effectiveProjectId } : {}),
					...(apiKeyId ? { apiKeyId } : {}),
				},
			},
		},
		{
			enabled: !!effectiveProjectId,
			initialData,
		},
	);

	if (!effectiveProjectId) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-muted-foreground">
					Please select a project to view cost breakdown
				</p>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				Loading cost data...
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-destructive">Error loading activity data</p>
			</div>
		);
	}

	if (!data || data.activity.length === 0) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-muted-foreground">
					No cost data available
					{selectedProject && (
						<span className="block mt-1 text-sm">
							Project: {selectedProject.name}
						</span>
					)}
				</p>
			</div>
		);
	}

	const providerCosts = new Map<string, number>();
	let totalStorageCost = 0;

	data.activity.forEach((day) => {
		day.modelBreakdown.forEach((model) => {
			const currentCost = providerCosts.get(model.provider) || 0;
			providerCosts.set(model.provider, currentCost + model.cost);
		});
		totalStorageCost += Number(day.dataStorageCost) || 0;
	});

	const chartData = Array.from(providerCosts.entries())
		.map(([provider, cost]) => ({
			name: provider,
			value: cost,
			color: getProviderColor(provider),
		}))
		.sort((a, b) => b.value - a.value);

	// Add storage cost as a separate item if it exists
	if (totalStorageCost > 0) {
		chartData.push({
			name: "LLM Gateway Storage",
			value: totalStorageCost,
			color: "#6366f1", // Indigo color for storage
		});
	}

	function getProviderColor(providerName: string) {
		// Find the provider in the providers array by name (case-insensitive)
		const provider = providers.find(
			(p) => p.name.toLowerCase() === providerName.toLowerCase(),
		);

		// Return the color if found, otherwise use a default color
		return provider?.color || "#94a3b8"; // Default color for unknown providers
	}

	const totalCost = chartData.reduce((sum, item) => sum + item.value, 0);
	const visibleSegments = showAllSegments ? chartData : chartData.slice(0, 7);

	return (
		<div>
			{chartData.length > 0 && (
				<div className="mb-4 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
					<div className="flex flex-wrap items-center gap-3">
						{visibleSegments.map((segment) => (
							<div key={segment.name} className="flex items-center gap-2">
								<span
									className="h-2 w-2 rounded-sm"
									style={{ backgroundColor: segment.color }}
								/>
								<span className="truncate max-w-[160px]">{segment.name}</span>
							</div>
						))}
						{chartData.length > 7 && (
							<button
								type="button"
								onClick={() => setShowAllSegments((prev) => !prev)}
								className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
							>
								{showAllSegments
									? "Show less"
									: `+${chartData.length - 7} more`}
							</button>
						)}
					</div>
					<div>
						<p>
							Total Cost:{" "}
							<span className="font-medium">${totalCost.toFixed(4)}</span>
						</p>
						{selectedProject && (
							<p className="mt-1 truncate">
								Project:{" "}
								<span className="font-medium">{selectedProject.name}</span>
							</p>
						)}
					</div>
				</div>
			)}

			<ResponsiveContainer width="100%" height={350}>
				<PieChart>
					<Pie
						data={chartData}
						cx="50%"
						cy="50%"
						innerRadius={60}
						outerRadius={100}
						paddingAngle={2}
						dataKey="value"
						label={({ name, percent }: { name?: string; percent?: number }) =>
							`${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`
						}
						labelLine={false}
					>
						{chartData.map((entry, index) => (
							<Cell key={`cell-${index}`} fill={entry.color} />
						))}
					</Pie>
					<Tooltip
						content={<CustomTooltip payload={[{ value: 0 }]} label="test" />}
					/>
				</PieChart>
			</ResponsiveContainer>
		</div>
	);
}
