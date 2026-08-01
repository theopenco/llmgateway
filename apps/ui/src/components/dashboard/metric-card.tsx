"use client";

import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";
import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

import { Skeleton } from "@/lib/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { cn } from "@/lib/utils";

const accentColors: Record<"green" | "blue" | "purple", string> = {
	green: "#10b981",
	blue: "#3b82f6",
	purple: "#8b5cf6",
};

function Sparkline({ trend, color }: { trend: number[]; color: string }) {
	const gradientId = useId();
	const chartData = trend.map((value, index) => ({ index, value }));

	return (
		<ResponsiveContainer width="100%" height="100%">
			<AreaChart
				data={chartData}
				margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
			>
				<defs>
					<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
						<stop offset="5%" stopColor={color} stopOpacity={0.35} />
						<stop offset="95%" stopColor={color} stopOpacity={0.02} />
					</linearGradient>
				</defs>
				<Area
					type="monotone"
					dataKey="value"
					stroke={color}
					strokeWidth={1.5}
					fill={`url(#${gradientId})`}
					isAnimationActive={false}
					dot={false}
				/>
			</AreaChart>
		</ResponsiveContainer>
	);
}

export function MetricCard({
	label,
	value,
	subtitle,
	icon,
	accent,
	tooltip,
	delta,
	deltaLabel = "vs previous period",
	trend,
	isLoading,
}: {
	label: string;
	value: string;
	subtitle?: string;
	icon?: React.ReactNode;
	accent?: "green" | "blue" | "purple";
	tooltip?: string;
	/** Percent change vs the previous period; null when not computable. */
	delta?: number | null;
	deltaLabel?: string;
	/** Daily values for the selected period, rendered as a sparkline. */
	trend?: number[];
	isLoading?: boolean;
}) {
	const accentColor = accentColors[accent ?? "blue"];
	const showTrend =
		!isLoading && trend && trend.length > 1 && trend.some((v) => v !== 0);
	const showDelta =
		!isLoading && typeof delta === "number" && Number.isFinite(delta);

	return (
		<div className="bg-card text-card-foreground relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/60 shadow-sm">
			<div className="flex items-start justify-between gap-3 p-4 pb-0 sm:p-5 sm:pb-0">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							{label}
						</p>
						{tooltip ? (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											aria-label={`More info about ${label}`}
											className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
										>
											<Info className="h-3 w-3" />
										</button>
									</TooltipTrigger>
									<TooltipContent side="top" className="max-w-xs text-center">
										{tooltip}
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						) : null}
					</div>
					{isLoading ? (
						<Skeleton className="mt-2 h-7 w-24 sm:h-8" />
					) : (
						<div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
							<p className="text-xl font-semibold tabular-nums break-all sm:text-2xl">
								{value}
							</p>
							{showDelta ? (
								<span
									title={deltaLabel}
									className={cn(
										"inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
										delta >= 0
											? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
											: "bg-red-500/10 text-red-600 dark:text-red-400",
									)}
								>
									{delta >= 0 ? (
										<ArrowUpRight className="h-3 w-3" />
									) : (
										<ArrowDownRight className="h-3 w-3" />
									)}
									{Math.abs(delta) >= 1000
										? ">999"
										: Math.abs(delta).toFixed(1)}
									%
								</span>
							) : null}
						</div>
					)}
					{isLoading ? (
						<Skeleton className="mt-2 h-3 w-32" />
					) : subtitle ? (
						<p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
					) : null}
				</div>
				{icon ? (
					<div
						className={cn(
							"hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs sm:inline-flex",
							accent === "green" &&
								"border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
							accent === "blue" &&
								"border-sky-500/30 bg-sky-500/10 text-sky-400",
							accent === "purple" &&
								"border-violet-500/30 bg-violet-500/10 text-violet-400",
						)}
					>
						{icon}
					</div>
				) : null}
			</div>
			<div className={cn("h-10", !showTrend && "h-4 sm:h-5")}>
				{showTrend ? <Sparkline trend={trend} color={accentColor} /> : null}
			</div>
		</div>
	);
}
