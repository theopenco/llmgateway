"use client";

import { format, parseISO, subDays } from "date-fns";
import { Coins, Hash, KeyRound, Zap } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
	Area,
	AreaChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { currencyFormatter } from "@/components/analytics/chart-helpers";
import {
	DateRangePicker,
	getDateRangeFromParams,
} from "@/components/date-range-picker";
import { MemberLimitsCard } from "@/components/team/member-limits-card";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { useApi } from "@/lib/fetch-client";

function SummaryStat({
	label,
	value,
	icon: Icon,
}: {
	label: string;
	value: string;
	icon: typeof Coins;
}) {
	return (
		<Card>
			<CardContent className="flex items-center gap-3 p-4">
				<div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-md">
					<Icon className="h-5 w-5" />
				</div>
				<div className="min-w-0">
					<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
						{label}
					</p>
					<p className="truncate text-2xl font-semibold tabular-nums">
						{value}
					</p>
				</div>
			</CardContent>
		</Card>
	);
}

export function DeveloperDashboardClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const projectId = params.projectId as string;
	const { buildUrl } = useDashboardNavigation();
	const router = useRouter();
	const searchParams = useSearchParams();
	const api = useApi();

	useEffect(() => {
		if (!searchParams.get("from") || !searchParams.get("to")) {
			const next = new URLSearchParams(searchParams.toString());
			next.delete("days");
			const today = new Date();
			next.set("from", format(subDays(today, 6), "yyyy-MM-dd"));
			next.set("to", format(today, "yyyy-MM-dd"));
			router.replace(`${buildUrl("me")}?${next.toString()}`);
		}
	}, [searchParams, router, buildUrl]);

	const { from, to } = getDateRangeFromParams(searchParams);
	const fromStr = format(from, "yyyy-MM-dd");
	const toStr = format(to, "yyyy-MM-dd");

	const { data, isLoading } = api.useQuery(
		"get",
		"/analytics/me",
		{
			params: {
				query: { organizationId, projectId, from: fromStr, to: toStr },
			},
		},
		{ enabled: !!organizationId && !!projectId, refetchOnWindowFocus: false },
	);

	const summary = data?.summary;
	const activity = data?.activity ?? [];

	const stats = [
		{
			label: "Total cost",
			value: currencyFormatter.format(summary?.cost ?? 0),
			icon: Coins,
		},
		{
			label: "Requests",
			value: (summary?.requestCount ?? 0).toLocaleString(),
			icon: Zap,
		},
		{
			label: "Tokens",
			value: (summary?.totalTokens ?? 0).toLocaleString(),
			icon: Hash,
		},
		{
			label: "Active API keys",
			value: (summary?.apiKeyCount ?? 0).toLocaleString(),
			icon: KeyRound,
		},
	];

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
						<p className="text-muted-foreground">
							Your usage and API keys for this project
						</p>
					</div>
					<DateRangePicker buildUrl={buildUrl} path="me" />
				</div>

				<MemberLimitsCard organizationId={organizationId} />

				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{stats.map((stat) => (
						<SummaryStat
							key={stat.label}
							label={stat.label}
							value={isLoading ? "—" : stat.value}
							icon={stat.icon}
						/>
					))}
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">Cost over time</CardTitle>
						<CardDescription>
							Your spend across the selected window
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ResponsiveContainer width="100%" height={280}>
							<AreaChart
								data={activity}
								margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
							>
								<defs>
									<linearGradient id="devCost" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
										<stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
									</linearGradient>
								</defs>
								<XAxis
									dataKey="date"
									tickFormatter={(d: string) => format(parseISO(d), "MMM d")}
									tickLine={false}
									axisLine={false}
									className="text-xs"
									minTickGap={24}
								/>
								<YAxis
									tickFormatter={(v: number) => `$${v.toFixed(2)}`}
									tickLine={false}
									axisLine={false}
									width={64}
									className="text-xs"
								/>
								<Tooltip
									formatter={(v: number) => currencyFormatter.format(v)}
									labelFormatter={(d: string) =>
										format(parseISO(d), "MMM d, yyyy")
									}
								/>
								<Area
									type="monotone"
									dataKey="cost"
									stroke="#3b82f6"
									strokeWidth={2}
									fill="url(#devCost)"
								/>
							</AreaChart>
						</ResponsiveContainer>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
