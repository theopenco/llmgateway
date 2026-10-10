"use client";

import { useState } from "react";
import { Label, Pie, PieChart } from "recharts";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	type ChartConfig,
} from "@/lib/components/chart";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { applyUsageModeToDaily, type UsageMode } from "@/lib/usage-mode";

import type { DailyActivity } from "@/types/activity";
import type { ViewBox } from "recharts/types/util/types";

const MODEL_COLORS = [
	"#3b82f6",
	"#f59e0b",
	"#10b981",
	"#8b5cf6",
	"#ef4444",
	"#06b6d4",
	"#f97316",
	"#ec4899",
	"#14b8a6",
	"#a855f7",
	"#eab308",
	"#6366f1",
	"#84cc16",
	"#0ea5e9",
	"#e11d48",
];

const CATALOGUE_COLORS: Record<string, string> = {
	openai: "#0ea5e9",
	anthropic: "#8b5cf6",
	deepseek: "#FF6B00",
};

const MAX_VISIBLE = 5;

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

const STORAGE_COLOR = "#6366f1";

const FALLBACK_COLORS = MODEL_COLORS.filter(
	(color) =>
		color !== STORAGE_COLOR && !Object.values(CATALOGUE_COLORS).includes(color),
);

function providerColor(provider: string, index: number) {
	return (
		CATALOGUE_COLORS[provider] ??
		FALLBACK_COLORS[index % FALLBACK_COLORS.length]
	);
}

interface Slice {
	model: string;
	label: string;
	cost: number;
	fill: string;
}

export function CostBreakdownCard({
	activity,
	usageMode,
	projectName,
}: {
	activity: DailyActivity[];
	usageMode: UsageMode;
	projectName: string;
}) {
	const [othersOpen, setOthersOpen] = useState(false);

	const modelCosts = new Map<string, { cost: number; provider: string }>();
	let storageCost = 0;
	let creditsTotal = 0;
	let apiKeysTotal = 0;
	for (const rawDay of activity) {
		creditsTotal += rawDay.creditsCost;
		apiKeysTotal += rawDay.apiKeysCost;
		const day = applyUsageModeToDaily(rawDay, usageMode);
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
		storageCost += day.dataStorageCost;
	}

	const sorted = Array.from(modelCosts.entries())
		.map(([model, { cost, provider }]) => ({ model, provider, cost }))
		.sort((a, b) => b.cost - a.cost);
	if (storageCost > 0) {
		sorted.push({
			model: "storage",
			provider: "LLM Gateway",
			cost: storageCost,
		});
	}

	const chartConfig: ChartConfig = { cost: { label: "Cost" } };
	const chartData: Slice[] = sorted.map((item, index) => {
		const key = item.model.replace(/[^a-zA-Z0-9]/g, "_");
		const label = item.model === "storage" ? "Storage" : item.model;
		chartConfig[key] = {
			label,
			color:
				item.model === "storage"
					? STORAGE_COLOR
					: providerColor(item.provider, index),
		};
		return { model: key, label, cost: item.cost, fill: `var(--color-${key})` };
	});
	const totalCost = chartData.reduce((sum, item) => sum + item.cost, 0);
	const visibleItems = chartData.slice(0, MAX_VISIBLE);
	const othersItems = chartData.slice(MAX_VISIBLE);
	const othersCost = othersItems.reduce((sum, item) => sum + item.cost, 0);

	const renderLegendItem = (item: Slice) => {
		const config = chartConfig[item.model];
		return (
			<div key={item.model} className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
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
				<div className="flex shrink-0 items-center gap-2 tabular-nums">
					<span className="font-medium">{formatCompactCost(item.cost)}</span>
					<span className="w-12 text-right text-muted-foreground">
						{totalCost > 0 ? ((item.cost / totalCost) * 100).toFixed(1) : "0"}%
					</span>
				</div>
			</div>
		);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Cost Breakdown</CardTitle>
				<CardDescription>
					Estimated costs by provider and storage for this project
				</CardDescription>
			</CardHeader>
			<CardContent className="@container">
				{chartData.length === 0 ? (
					<div className="flex h-full items-center justify-center">
						<p className="text-muted-foreground">No cost data available</p>
					</div>
				) : (
					<div className="flex h-full flex-col gap-4 @lg:flex-row">
						<ChartContainer
							config={chartConfig}
							className="mx-auto aspect-square w-full max-w-[280px]"
						>
							<PieChart>
								<ChartTooltip
									cursor={false}
									content={
										<ChartTooltipContent
											hideLabel
											formatter={(value, name) => (
												<div className="flex items-center gap-2">
													<span className="text-muted-foreground">
														{chartConfig[String(name)]?.label ?? name}
													</span>
													<span className="font-mono font-medium">
														${Number(value).toFixed(4)}
													</span>
												</div>
											)}
										/>
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
									<Label
										content={({ viewBox }: { viewBox?: ViewBox }) =>
											viewBox && "cx" in viewBox && "cy" in viewBox ? (
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
											) : null
										}
									/>
								</Pie>
							</PieChart>
						</ChartContainer>
						<div className="flex min-w-0 flex-1 flex-col justify-center gap-3 text-sm">
							<p className="text-muted-foreground">
								Project:{" "}
								<span className="font-medium text-foreground">
									{projectName}
								</span>
							</p>
							<div className="flex flex-col gap-1.5">
								{visibleItems.map(renderLegendItem)}
								{othersItems.length > 0 && (
									<Popover open={othersOpen} onOpenChange={setOthersOpen}>
										<PopoverTrigger asChild>
											<button
												type="button"
												className="-mx-1 flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/50"
											>
												<div className="flex min-w-0 items-center gap-2">
													<span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-muted-foreground/40" />
													<span className="text-muted-foreground">
														+{othersItems.length} more
													</span>
												</div>
												<div className="flex shrink-0 items-center gap-2 tabular-nums">
													<span className="font-medium">
														{formatCompactCost(othersCost)}
													</span>
													<span className="w-12 text-right text-muted-foreground">
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
											className="max-h-64 w-80 overflow-y-auto p-3"
										>
											<div className="flex flex-col gap-1.5 text-sm">
												{othersItems.map(renderLegendItem)}
											</div>
										</PopoverContent>
									</Popover>
								)}
							</div>
							{usageMode === "total" &&
								creditsTotal > 0 &&
								apiKeysTotal > 0 && (
									<div className="flex flex-col gap-1.5 border-t pt-3 text-sm">
										<div className="flex items-center justify-between gap-2">
											<span className="text-muted-foreground">
												Credits (billed)
											</span>
											<span className="font-medium tabular-nums">
												{formatCompactCost(creditsTotal)}
											</span>
										</div>
										<div className="flex items-center justify-between gap-2">
											<span className="text-muted-foreground">
												BYOK keys (not billed)
											</span>
											<span className="font-medium tabular-nums">
												{formatCompactCost(apiKeysTotal)}
											</span>
										</div>
									</div>
								)}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
