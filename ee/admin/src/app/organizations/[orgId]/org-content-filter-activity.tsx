"use client";

import { format } from "date-fns";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getOrganizationContentFilterActivity } from "@/lib/admin-content-filter";

import type { ChartConfig } from "@/components/ui/chart";
import type { TokenWindow } from "@/lib/types";

type Activity = NonNullable<
	Awaited<ReturnType<typeof getOrganizationContentFilterActivity>>
>;

const validWindows = new Set<TokenWindow>([
	"1h",
	"4h",
	"12h",
	"1d",
	"7d",
	"30d",
	"90d",
	"365d",
]);

function parseWindow(value: string | null): TokenWindow {
	if (value && validWindows.has(value as TokenWindow)) {
		return value as TokenWindow;
	}
	return "1d";
}

const chartConfig = {
	sampledCount: { label: "Sampled", color: "hsl(221 83% 53%)" },
	violationCount: { label: "Violations", color: "hsl(32 95% 44%)" },
	blockedCount: { label: "Blocked", color: "hsl(0 84% 60%)" },
} satisfies ChartConfig;

const percentFormatter = new Intl.NumberFormat("en-US", {
	style: "percent",
	maximumFractionDigits: 1,
});

export function OrgContentFilterActivity({ orgId }: { orgId: string }) {
	const searchParams = useSearchParams();
	const window = parseWindow(searchParams.get("window"));
	const [data, setData] = useState<Activity | null>(null);
	const [loading, setLoading] = useState(true);
	const latestRequestRef = useRef(0);

	useEffect(() => {
		const requestId = ++latestRequestRef.current;
		setLoading(true);
		void getOrganizationContentFilterActivity(orgId, window)
			.then((result) => {
				if (requestId === latestRequestRef.current) {
					setData(result);
				}
			})
			.catch((error: unknown) => {
				if (requestId === latestRequestRef.current) {
					console.error("Failed to load content filter activity:", error);
					setData(null);
				}
			})
			.finally(() => {
				if (requestId === latestRequestRef.current) {
					setLoading(false);
				}
			});
	}, [orgId, window]);

	const bucket = data?.bucket ?? "day";
	const formatTimestamp = (ts: string) =>
		format(new Date(ts), bucket === "hour" ? "MMM d HH:mm" : "MMM d");
	const hasActivity = (data?.totals.sampledCount ?? 0) > 0;

	return (
		<Card id="content-filter" className="scroll-mt-20">
			<CardHeader className="pb-2">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<CardTitle className="flex items-center gap-2 text-base">
							<ShieldCheck className="h-4 w-4 text-muted-foreground" />
							Content Filter Activity
						</CardTitle>
						<CardDescription>
							Requests the gateway content filter sampled for this organization
							over the selected window, and how many crossed their tier&apos;s
							thresholds, broken down by category and by the model that served
							the request. Sampled counts every moderated request; blocked is
							the subset actually rejected.
						</CardDescription>
					</div>
					<Link
						href="/content-filter"
						className="text-xs text-muted-foreground underline-offset-2 hover:underline"
					>
						All organizations
					</Link>
				</div>
			</CardHeader>
			<CardContent className="px-2 pb-4 sm:px-6">
				{loading ? (
					<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
						Loading...
					</div>
				) : !data || !hasActivity ? (
					<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
						No sampled requests in this time window
					</div>
				) : (
					<>
						<div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
							<div>
								<span className="text-muted-foreground">Sampled</span>
								<p className="text-xl font-semibold tabular-nums">
									{data.totals.sampledCount.toLocaleString("en-US")}
								</p>
							</div>
							<div>
								<span className="text-muted-foreground">Violations</span>
								<p className="text-xl font-semibold tabular-nums">
									{data.totals.violationCount.toLocaleString("en-US")}
								</p>
							</div>
							<div>
								<span className="text-muted-foreground">Rate</span>
								<p className="text-xl font-semibold tabular-nums">
									{percentFormatter.format(data.totals.violationRate)}
								</p>
							</div>
							<div>
								<span className="text-muted-foreground">Blocked</span>
								<p className="text-xl font-semibold tabular-nums">
									{data.totals.blockedCount.toLocaleString("en-US")}
								</p>
							</div>
							{data.topCategories.length > 0 ? (
								<div className="flex flex-wrap items-center gap-1.5">
									<span className="text-muted-foreground">Top categories</span>
									{data.topCategories.map((entry) => (
										<Badge key={entry.category} variant="outline">
											{entry.category} ({entry.violationCount})
										</Badge>
									))}
								</div>
							) : null}
						</div>
						<ChartContainer
							config={chartConfig}
							className="aspect-auto h-[260px] w-full"
						>
							<BarChart
								data={data.data}
								accessibilityLayer
								margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
							>
								<CartesianGrid vertical={false} strokeDasharray="3 3" />
								<XAxis
									dataKey="timestamp"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={40}
									tickFormatter={formatTimestamp}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									tickMargin={4}
									width={40}
									allowDecimals={false}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											labelFormatter={(value: string) => formatTimestamp(value)}
										/>
									}
								/>
								<ChartLegend content={<ChartLegendContent />} />
								<Bar
									dataKey="sampledCount"
									fill="var(--color-sampledCount)"
									radius={2}
								/>
								<Bar
									dataKey="violationCount"
									fill="var(--color-violationCount)"
									radius={2}
								/>
								<Bar
									dataKey="blockedCount"
									fill="var(--color-blockedCount)"
									radius={2}
								/>
							</BarChart>
						</ChartContainer>
						{data.topModels.length > 0 ? (
							<div className="mt-4">
								<p className="mb-2 text-sm font-medium">Top models</p>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Model</TableHead>
											<TableHead className="text-right">Sampled</TableHead>
											<TableHead className="text-right">Violations</TableHead>
											<TableHead className="text-right">Rate</TableHead>
											<TableHead className="text-right">Blocked</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data.topModels.map((model) => (
											<TableRow
												key={`${model.usedProvider}/${model.usedModel}`}
											>
												<TableCell className="font-medium">
													{model.usedModel}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{model.sampledCount.toLocaleString("en-US")}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{model.violationCount.toLocaleString("en-US")}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{percentFormatter.format(model.violationRate)}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{model.blockedCount.toLocaleString("en-US")}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						) : null}
					</>
				)}
			</CardContent>
		</Card>
	);
}
