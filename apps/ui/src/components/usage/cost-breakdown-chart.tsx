"use client";

import { format } from "date-fns";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Label, Pie, PieChart } from "recharts";

import { getDateRangeFromParams } from "@/components/date-range-picker";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/lib/components/chart";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { useApi } from "@/lib/fetch-client";

import { providers } from "@llmgateway/models";

import type { ChartConfig } from "@/lib/components/chart";
import type { ActivitT } from "@/types/activity";
import type { ViewBox } from "recharts/types/util/types";

interface CostBreakdownChartProps {
	initialData?: ActivitT;
	projectId?: string;
	apiKeyId?: string;
}

const MODEL_COLORS = [
	"#3b82f6", // blue
	"#f59e0b", // amber
	"#10b981", // emerald
	"#8b5cf6", // violet
	"#ef4444", // red
	"#06b6d4", // cyan
	"#f97316", // orange
	"#ec4899", // pink
	"#14b8a6", // teal
	"#a855f7", // purple
	"#eab308", // yellow
	"#6366f1", // indigo
	"#84cc16", // lime
	"#0ea5e9", // sky
	"#e11d48", // rose
];

function formatCompactCost(value: number): string {
	if (value >= 1_000_000_000) {
		return `$${(value / 1_000_000_000).toFixed(1)}B`;
	}
	if (value >= 1_000_000) {
		return `$${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `$${(value / 1_000).toFixed(1)}K`;
	}
	return `$${value.toFixed(2)}`;
}

function isLowContrastColor(hex: string): boolean {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	// eslint-disable-next-line no-mixed-operators
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return luminance < 0.15 || luminance > 0.85;
}

function getProviderColor(providerName: string, index: number) {
	const provider = providers.find(
		(p) => p.name.toLowerCase() === providerName.toLowerCase(),
	);
	const color = provider?.color;
	if (!color || isLowContrastColor(color)) {
		return MODEL_COLORS[index % MODEL_COLORS.length];
	}
	return color;
}

export function CostBreakdownChart({
	initialData,
	projectId,
	apiKeyId,
}: CostBreakdownChartProps) {
	const searchParams = useSearchParams();
	const { selectedProject } = useDashboardNavigation();

	const { from, to } = getDateRangeFromParams(searchParams);
	const fromStr = format(from, "yyyy-MM-dd");
	const toStr = format(to, "yyyy-MM-dd");

	const effectiveProjectId = projectId ?? selectedProject?.id;

	const api = useApi();
	const { data, isLoading, error } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					from: fromStr,
					to: toStr,
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

	const { chartData, chartConfig, totalCost } = useMemo(() => {
		if (!data || data.activity.length === 0) {
			return { chartData: [], chartConfig: {} as ChartConfig, totalCost: 0 };
		}

		const modelCosts = new Map<string, { cost: number; provider: string }>();
		let storageCost = 0;

		for (const day of data.activity) {
			for (const model of day.modelBreakdown) {
				const existing = modelCosts.get(model.id);
				if (existing) {
					existing.cost += model.cost;
				} else {
					modelCosts.set(model.id, {
						cost: model.cost,
						provider: model.provider,
					});
				}
			}
			storageCost += Number(day.dataStorageCost) || 0;
		}

		const sorted = Array.from(modelCosts.entries())
			.map(([modelId, { cost, provider }]) => ({
				model: modelId,
				provider,
				cost,
			}))
			.sort((a, b) => b.cost - a.cost);

		if (storageCost > 0) {
			sorted.push({
				model: "storage",
				provider: "LLM Gateway",
				cost: storageCost,
			});
		}

		const config: ChartConfig = {
			cost: { label: "Cost" },
		};

		const pieData = sorted.map((item, i) => {
			const key = item.model.replace(/[^a-zA-Z0-9]/g, "_");
			const color =
				item.model === "storage"
					? "#6366f1"
					: getProviderColor(item.provider, i);

			config[key] = {
				label: item.model === "storage" ? "Storage" : item.model,
				color,
			};

			return {
				model: key,
				label: item.model === "storage" ? "Storage" : item.model,
				cost: item.cost,
				fill: `var(--color-${key})`,
			};
		});

		const total = pieData.reduce((sum, item) => sum + item.cost, 0);

		return { chartData: pieData, chartConfig: config, totalCost: total };
	}, [data]);

	const pieLabelContent = useCallback(
		({ viewBox }: { viewBox?: ViewBox }) => {
			if (viewBox && "cx" in viewBox && "cy" in viewBox) {
				return (
					<text
						x={viewBox.cx}
						y={viewBox.cy}
						textAnchor="middle"
						dominantBaseline="middle"
					>
						<tspan
							x={viewBox.cx}
							y={viewBox.cy}
							className="fill-foreground text-xl font-bold"
						>
							{formatCompactCost(totalCost)}
						</tspan>
						<tspan
							x={viewBox.cx}
							y={(viewBox.cy ?? 0) + 20}
							className="fill-muted-foreground text-xs"
						>
							Total Cost
						</tspan>
					</text>
				);
			}
			return null;
		},
		[totalCost],
	);

	const costFormatter = useCallback(
		(value: string | number | (string | number)[], name: string | number) => (
			<div className="flex items-center gap-2">
				<span className="text-muted-foreground">
					{chartConfig[String(name)]?.label ?? name}
				</span>
				<span className="font-mono font-medium">
					${Number(value).toFixed(4)}
				</span>
			</div>
		),
		[chartConfig],
	);

	const MAX_VISIBLE = 5;

	const { visibleItems, othersItems, othersCost } = useMemo(() => {
		if (chartData.length <= MAX_VISIBLE) {
			return { visibleItems: chartData, othersItems: [], othersCost: 0 };
		}
		const visible = chartData.slice(0, MAX_VISIBLE);
		const others = chartData.slice(MAX_VISIBLE);
		const cost = others.reduce((sum, item) => sum + item.cost, 0);
		return { visibleItems: visible, othersItems: others, othersCost: cost };
	}, [chartData]);

	const [othersOpen, setOthersOpen] = useState(false);

	if (!effectiveProjectId) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-muted-foreground">
					Please select a project to view cost breakdown
				</p>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-muted-foreground">Loading cost data...</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-destructive">Error loading activity data</p>
			</div>
		);
	}

	if (chartData.length === 0) {
		return (
			<div className="flex h-full items-center justify-center">
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

	const renderLegendItem = (item: (typeof chartData)[number]) => {
		const percent =
			totalCost > 0 ? ((item.cost / totalCost) * 100).toFixed(1) : "0";
		const config = chartConfig[item.model];
		return (
			<div key={item.model} className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 min-w-0">
					<span
						className="h-2.5 w-2.5 shrink-0 rounded-sm"
						style={{
							backgroundColor:
								(config && "color" in config ? config.color : undefined) ??
								"#94a3b8",
						}}
					/>
					<span className="truncate text-muted-foreground">{item.label}</span>
				</div>
				<div className="flex items-center gap-2 shrink-0 tabular-nums">
					<span className="font-medium">{formatCompactCost(item.cost)}</span>
					<span className="text-muted-foreground w-12 text-right">
						{percent}%
					</span>
				</div>
			</div>
		);
	};

	return (
		<div className="flex h-full flex-col gap-4 md:flex-row">
			<ChartContainer
				config={chartConfig}
				className="mx-auto aspect-square w-full max-w-[280px]"
			>
				<PieChart>
					<ChartTooltip
						cursor={false}
						content={
							<ChartTooltipContent hideLabel formatter={costFormatter} />
						}
					/>
					<Pie
						data={chartData}
						dataKey="cost"
						nameKey="model"
						innerRadius={60}
						strokeWidth={2}
						stroke="hsl(var(--background))"
					>
						<Label content={pieLabelContent} />
					</Pie>
				</PieChart>
			</ChartContainer>
			<div className="flex flex-1 flex-col justify-center gap-3 text-sm">
				{selectedProject && (
					<p className="text-muted-foreground">
						Project:{" "}
						<span className="font-medium text-foreground">
							{selectedProject.name}
						</span>
					</p>
				)}
				<div className="flex flex-col gap-1.5">
					{visibleItems.map(renderLegendItem)}
					{othersItems.length > 0 && (
						<Popover open={othersOpen} onOpenChange={setOthersOpen}>
							<PopoverTrigger asChild>
								<button
									type="button"
									className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 -mx-1 transition-colors hover:bg-muted/50"
								>
									<div className="flex items-center gap-2 min-w-0">
										<span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-muted-foreground/40" />
										<span className="text-muted-foreground">
											+{othersItems.length} more
										</span>
									</div>
									<div className="flex items-center gap-2 shrink-0 tabular-nums">
										<span className="font-medium">
											{formatCompactCost(othersCost)}
										</span>
										<span className="text-muted-foreground w-12 text-right">
											{totalCost > 0
												? ((othersCost / totalCost) * 100).toFixed(1)
												: "0"}
											%
										</span>
									</div>
								</button>
							</PopoverTrigger>
							<PopoverContent
								align="start"
								side="bottom"
								className="w-80 max-h-64 overflow-y-auto p-3"
							>
								<div className="flex flex-col gap-1.5 text-sm">
									{othersItems.map(renderLegendItem)}
								</div>
							</PopoverContent>
						</Popover>
					)}
				</div>
			</div>
		</div>
	);
}
