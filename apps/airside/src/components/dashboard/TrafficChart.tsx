"use client";

import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { formatCompact, formatUsd } from "@/lib/format";

interface DailyPoint {
	day: string;
	requestCount: number;
	errorCount: number;
	outputTokens: number;
	cost: number;
}

export function TrafficChart({ daily }: { daily: DailyPoint[] }) {
	if (daily.length === 0) {
		return (
			<div className="text-muted-foreground flex h-56 items-center justify-center font-mono text-xs tracking-widest uppercase">
				No traffic recorded in this window
			</div>
		);
	}

	const data = daily.map((point) => ({
		...point,
		label: new Date(point.day).toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			// Buckets are UTC days; a viewer west of UTC would otherwise see
			// every label shifted a day back.
			timeZone: "UTC",
		}),
	}));

	return (
		<div className="h-56 w-full" data-testid="traffic-chart">
			<ResponsiveContainer width="100%" height="100%">
				<AreaChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
					<defs>
						<linearGradient id="fillRequests" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
							<stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
						</linearGradient>
					</defs>
					<CartesianGrid
						strokeDasharray="3 3"
						stroke="var(--border)"
						vertical={false}
					/>
					<XAxis
						dataKey="label"
						tickLine={false}
						axisLine={false}
						tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
					/>
					<YAxis
						tickLine={false}
						axisLine={false}
						width={40}
						tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
						tickFormatter={(value: number) => formatCompact(value)}
					/>
					<Tooltip
						cursor={{ stroke: "var(--border)" }}
						content={({ active, payload }) => {
							if (!active || !payload?.length) {
								return null;
							}
							const point = payload[0].payload as DailyPoint & {
								label: string;
							};
							return (
								<div className="border-border bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
									<div className="font-mono font-bold">{point.label}</div>
									<div className="mt-1 space-y-0.5">
										<div>{formatCompact(point.requestCount)} requests</div>
										<div>{formatUsd(point.cost)} billed</div>
										<div>{formatCompact(point.outputTokens)} tokens out</div>
									</div>
								</div>
							);
						}}
					/>
					<Area
						type="monotone"
						dataKey="requestCount"
						stroke="var(--chart-1)"
						strokeWidth={2}
						fill="url(#fillRequests)"
					/>
				</AreaChart>
			</ResponsiveContainer>
		</div>
	);
}
