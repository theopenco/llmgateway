import { useMemo } from "react";
import {
	Area,
	AreaChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { formatTokens } from "@/app/dashboard/components/coding-agents-shared";

interface ProfileTokensChartProps {
	activity: { date: string; totalTokens: number }[];
}

function formatDay(iso: string): string {
	const d = new Date(iso + "T00:00:00Z");
	return d.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

export function ProfileTokensChart({ activity }: ProfileTokensChartProps) {
	const data = useMemo(() => {
		const today = new Date();
		today.setUTCHours(0, 0, 0, 0);
		const start = new Date(today);
		start.setUTCDate(start.getUTCDate() - 29);

		const byDate = new Map<string, number>();
		for (const row of activity) {
			byDate.set(row.date.slice(0, 10), row.totalTokens ?? 0);
		}

		const days: { date: string; tokens: number }[] = [];
		const cursor = new Date(start);
		while (cursor <= today) {
			const key = cursor.toISOString().slice(0, 10);
			days.push({ date: key, tokens: byDate.get(key) ?? 0 });
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		}
		return days;
	}, [activity]);

	const hasData = data.some((d) => d.tokens > 0);

	return (
		<div className="h-52 w-full">
			<ResponsiveContainer width="100%" height="100%">
				<AreaChart
					data={data}
					margin={{ top: 8, right: 4, left: 4, bottom: 0 }}
				>
					<defs>
						<linearGradient id="profileTokens" x1="0" y1="0" x2="0" y2="1">
							<stop
								offset="0%"
								stopColor="var(--color-emerald-500, #10b981)"
								stopOpacity={0.35}
							/>
							<stop
								offset="100%"
								stopColor="var(--color-emerald-500, #10b981)"
								stopOpacity={0}
							/>
						</linearGradient>
					</defs>
					<XAxis
						dataKey="date"
						tickFormatter={formatDay}
						tick={{ fontSize: 10 }}
						stroke="currentColor"
						className="text-muted-foreground"
						tickLine={false}
						axisLine={false}
						interval="preserveStartEnd"
						minTickGap={48}
					/>
					<YAxis hide domain={[0, "dataMax"]} />
					{hasData && (
						<Tooltip
							cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
							content={({ active, payload }) => {
								if (!active || !payload?.length) {
									return null;
								}
								const point = payload[0].payload as {
									date: string;
									tokens: number;
								};
								return (
									<div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
										<div className="font-medium">{formatDay(point.date)}</div>
										<div className="text-muted-foreground">
											{formatTokens(point.tokens)} tokens
										</div>
									</div>
								);
							}}
						/>
					)}
					<Area
						type="monotone"
						dataKey="tokens"
						stroke="#10b981"
						strokeWidth={2}
						fill="url(#profileTokens)"
						dot={false}
						activeDot={{ r: 3 }}
						isAnimationActive={false}
					/>
				</AreaChart>
			</ResponsiveContainer>
			{!hasData && (
				<p className="-mt-28 text-center text-xs text-muted-foreground">
					No token usage in the last 30 days yet.
				</p>
			)}
		</div>
	);
}
