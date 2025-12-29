"use client";

import { DollarSign, TrendingUp, Coins } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { MetricCard } from "@/components/dashboard/metric-card";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { mockCostBreakdown, mockMetrics } from "@/lib/mock-feature-data";

const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b"];

function PieTooltipContent({ payload }: { payload: any }) {
	if (payload && payload.length) {
		return (
			<div className="rounded-lg border bg-popover text-popover-foreground p-2 shadow-sm">
				<p className="font-medium">{payload[0].name}</p>
				<p className="text-sm">${Number(payload[0].value).toFixed(2)}</p>
			</div>
		);
	}
	return null;
}

export function CostAnalyticsDemo() {
	const pieData = mockCostBreakdown.providers.map((p) => ({
		name: p.name,
		value: p.cost,
	}));

	return (
		<div className="space-y-6">
			<div className="grid gap-4 md:grid-cols-3">
				<MetricCard
					label="Total Spend"
					value={`$${mockCostBreakdown.total.toFixed(2)}`}
					subtitle="Last 7 days"
					icon={<DollarSign className="h-4 w-4" />}
					accent="green"
				/>
				<MetricCard
					label="Avg Cost per 1K Tokens"
					value="$0.106"
					subtitle="Blended rate"
					icon={<Coins className="h-4 w-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Total Tokens"
					value={mockMetrics.totalTokens}
					subtitle="Input + Output"
					icon={<TrendingUp className="h-4 w-4" />}
					accent="purple"
				/>
			</div>

			<div className="grid gap-6 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Cost by Provider</CardTitle>
						<CardDescription>
							Distribution of spending across providers
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ResponsiveContainer width="100%" height={300}>
							<PieChart>
								<Pie
									data={pieData}
									cx="50%"
									cy="50%"
									labelLine={false}
									label={(props: any) => {
										const { name, percent } = props;
										return `${name} ${((percent as number) * 100).toFixed(0)}%`;
									}}
									outerRadius={80}
									fill="#8884d8"
									dataKey="value"
								>
									{pieData.map((entry, index) => (
										<Cell
											key={`cell-${index}`}
											fill={COLORS[index % COLORS.length]}
										/>
									))}
								</Pie>
								<Tooltip content={<PieTooltipContent payload={[]} />} />
							</PieChart>
						</ResponsiveContainer>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Provider Breakdown</CardTitle>
						<CardDescription>
							Detailed cost analysis by provider
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-3">
							{mockCostBreakdown.providers.map((provider, index) => (
								<div
									key={provider.name}
									className="flex items-center justify-between p-3 rounded-lg border"
								>
									<div className="flex items-center gap-3">
										<div
											className="h-3 w-3 rounded-full"
											style={{ backgroundColor: COLORS[index % COLORS.length] }}
										/>
										<div>
											<p className="font-medium">{provider.name}</p>
											<p className="text-sm text-muted-foreground">
												{provider.percentage.toFixed(1)}% of total
											</p>
										</div>
									</div>
									<div className="text-right">
										<p className="font-semibold">${provider.cost.toFixed(2)}</p>
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
