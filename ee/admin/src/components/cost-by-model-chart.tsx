"use client";

import { Cpu, Layers, Server } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

import type { ChartConfig } from "@/components/ui/chart";
import type { GlobalStatsModelView, TokenWindow } from "@/lib/types";

export interface CostByModelEntry {
	model: string;
	cost: number;
	requestCount: number;
	totalTokens: number;
}

export interface CostByModelData {
	window: TokenWindow;
	models: CostByModelEntry[];
	totalCost: number;
	totalRequests: number;
}

type ActiveView = "cost" | "requests" | "tokens";

const viewConfigs: Record<ActiveView, ChartConfig> = {
	cost: {
		cost: { label: "Cost ($)", color: "hsl(142 71% 45%)" },
	},
	requests: {
		requestCount: { label: "Requests", color: "hsl(221 83% 53%)" },
	},
	tokens: {
		totalTokens: { label: "Tokens", color: "hsl(32 95% 44%)" },
	},
};

const modelViewOptions: {
	value: GlobalStatsModelView;
	label: string;
	icon: typeof Cpu;
}[] = [
	{ value: "mapping", label: "Mappings", icon: Layers },
	{ value: "canonical", label: "Canonical", icon: Cpu },
	{ value: "provider", label: "Providers", icon: Server },
];

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

export function CostByModelChart({
	title,
	description,
	fetchData,
	fetchDataRange,
	externalWindow,
	showModelView = false,
	modelView: controlledModelView,
	onModelViewChange,
	forceRange = false,
	from,
	to,
}: {
	title: string;
	description?: string;
	fetchData?: (
		window: TokenWindow,
		modelView: GlobalStatsModelView,
	) => Promise<CostByModelData | null>;
	fetchDataRange?: (
		from: string | undefined,
		to: string | undefined,
		modelView: GlobalStatsModelView,
	) => Promise<CostByModelData | null>;
	externalWindow?: TokenWindow;
	showModelView?: boolean;
	modelView?: GlobalStatsModelView;
	onModelViewChange?: (value: GlobalStatsModelView) => void;
	forceRange?: boolean;
	from?: string;
	to?: string;
}) {
	const [data, setData] = useState<CostByModelData | null>(null);
	const [loading, setLoading] = useState(true);
	const window = externalWindow ?? "7d";
	const [activeView, setActiveView] = useState<ActiveView>("cost");
	const [internalModelView, setInternalModelView] =
		useState<GlobalStatsModelView>("mapping");
	const modelView = controlledModelView ?? internalModelView;
	const setModelView = onModelViewChange ?? setInternalModelView;
	const useRange = forceRange || Boolean(from && to);
	const requestIdRef = useRef(0);

	const loadData = useCallback(async () => {
		const requestId = ++requestIdRef.current;
		setLoading(true);
		try {
			let result: CostByModelData | null = null;
			if (useRange && fetchDataRange) {
				result = await fetchDataRange(from, to, modelView);
			} else if (fetchData) {
				result = await fetchData(window, modelView);
			}
			if (requestId === requestIdRef.current) {
				setData(result);
			}
		} catch (error) {
			console.error("Failed to load cost by model:", error);
			if (requestId === requestIdRef.current) {
				setData(null);
			}
		} finally {
			if (requestId === requestIdRef.current) {
				setLoading(false);
			}
		}
	}, [fetchData, fetchDataRange, window, modelView, from, to, useRange]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	const config = viewConfigs[activeView];
	const dataKey = Object.keys(config)[0];

	const viewTabs: { key: ActiveView; label: string }[] = [
		{ key: "cost", label: "Cost" },
		{ key: "requests", label: "Requests" },
		{ key: "tokens", label: "Tokens" },
	];

	return (
		<Card>
			<CardHeader className="space-y-4 pb-2">
				<div className="flex items-start justify-between gap-4">
					<div>
						<CardTitle className="text-base">{title}</CardTitle>
						{description && <CardDescription>{description}</CardDescription>}
						{data && (
							<div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
								<span>
									Total Cost:{" "}
									<strong className="text-foreground">
										{currencyFormatter.format(data.totalCost)}
									</strong>
								</span>
								<span>
									Total Requests:{" "}
									<strong className="text-foreground">
										{data.totalRequests.toLocaleString()}
									</strong>
								</span>
							</div>
						)}
					</div>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
					<div className="flex items-center gap-1">
						{viewTabs.map((tab) => (
							<button
								key={tab.key}
								className={cn(
									"rounded-md px-3 py-1 text-xs font-medium transition-colors",
									activeView === tab.key
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
								onClick={() => setActiveView(tab.key)}
							>
								{tab.label}
							</button>
						))}
					</div>
					{showModelView && (
						<div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-1">
							{modelViewOptions.map((opt) => {
								const Icon = opt.icon;
								return (
									<Button
										key={opt.value}
										variant={modelView === opt.value ? "default" : "ghost"}
										size="sm"
										className="h-7 gap-1.5 px-3 text-xs"
										onClick={() => setModelView(opt.value)}
									>
										<Icon className="h-3.5 w-3.5" />
										{opt.label}
									</Button>
								);
							})}
						</div>
					)}
				</div>
			</CardHeader>
			<CardContent className="px-2 pb-4 sm:px-6">
				{loading ? (
					<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
						Loading...
					</div>
				) : !data || data.models.length === 0 ? (
					<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
						No data for this time window
					</div>
				) : (
					<ChartContainer
						config={config}
						className="aspect-auto w-full"
						style={{
							height: `${Math.max(300, data.models.length * 28)}px`,
						}}
					>
						<BarChart
							data={data.models}
							layout="vertical"
							margin={{ left: 8, right: 8, top: 20, bottom: 4 }}
						>
							<CartesianGrid horizontal={false} strokeDasharray="3 3" />
							<YAxis
								dataKey="model"
								type="category"
								tickLine={false}
								axisLine={false}
								width={160}
								tickFormatter={(value: string) =>
									value.length > 24 ? `${value.slice(0, 22)}...` : value
								}
								className="text-xs"
							/>
							<XAxis
								type="number"
								tickLine={false}
								axisLine={false}
								tickFormatter={(value: number) => {
									if (activeView === "cost") {
										return `$${value >= 1 ? value.toFixed(2) : value.toFixed(4)}`;
									}
									return value >= 1000
										? `${(value / 1000).toFixed(1)}k`
										: String(value);
								}}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										formatter={(value) => {
											if (activeView === "cost") {
												return currencyFormatter.format(Number(value));
											}
											return Number(value).toLocaleString();
										}}
									/>
								}
							/>
							<Bar
								dataKey={dataKey}
								fill={`var(--color-${dataKey})`}
								radius={[0, 4, 4, 0]}
							/>
						</BarChart>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}
