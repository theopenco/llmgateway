import {
	AlertTriangle,
	ArrowDownToLine,
	ArrowUpFromLine,
	Building2,
	CircleDollarSign,
	PiggyBank,
	ShieldCheck,
	UserCheck,
	Users,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { RevenueChart } from "@/components/revenue-chart";
import { SignupsChart } from "@/components/signups-chart";
import { TimeRangePicker } from "@/components/time-range-picker";
import { Button } from "@/components/ui/button";
import {
	getAdminDashboardMetrics,
	getAdminTimeseriesMetrics,
} from "@/lib/admin-metrics";
import { cn } from "@/lib/utils";

import type { TimeseriesRange } from "@/lib/admin-metrics";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

function MetricCard({
	label,
	value,
	subtitle,
	icon,
	accent,
}: {
	label: string;
	value: string;
	subtitle?: string;
	icon?: React.ReactNode;
	accent?: "green" | "blue" | "purple" | "red";
}) {
	return (
		<div className="bg-card text-card-foreground flex flex-col justify-between gap-3 rounded-xl border border-border/60 p-5 shadow-sm">
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{label}
					</p>
					<p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
					{subtitle ? (
						<p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
					) : null}
				</div>
				{icon ? (
					<div
						className={cn(
							"inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs",
							accent === "green" &&
								"border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
							accent === "blue" &&
								"border-sky-500/30 bg-sky-500/10 text-sky-400",
							accent === "purple" &&
								"border-violet-500/30 bg-violet-500/10 text-violet-400",
							accent === "red" &&
								"border-red-500/30 bg-red-500/10 text-red-400",
						)}
					>
						{icon}
					</div>
				) : null}
			</div>
		</div>
	);
}

function SignInPrompt() {
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md text-center">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
				</div>
				<Button asChild size="lg" className="w-full">
					<Link href="/login">Sign In</Link>
				</Button>
			</div>
		</div>
	);
}

const validRanges = new Set(["7d", "30d", "90d", "365d", "all"]);

export default async function Page({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const params = await searchParams;
	const rangeParam = typeof params.range === "string" ? params.range : "30d";
	const range: TimeseriesRange = validRanges.has(rangeParam)
		? (rangeParam as TimeseriesRange)
		: "30d";

	const [metrics, timeseries] = await Promise.all([
		getAdminDashboardMetrics(),
		getAdminTimeseriesMetrics(range),
	]);

	if (!metrics) {
		return <SignInPrompt />;
	}

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Overview of users, customers, and revenue.
					</p>
				</div>
				<div className="flex items-center gap-3">
					<Suspense>
						<TimeRangePicker value={range} />
					</Suspense>
					<div className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
						<span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
						<span>Live data</span>
					</div>
				</div>
			</header>

			<section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				<MetricCard
					label="Total Sign Ups"
					value={numberFormatter.format(metrics.totalSignups)}
					subtitle="All registered user accounts"
					icon={<Users className="h-4 w-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Verified Users"
					value={numberFormatter.format(metrics.verifiedUsers)}
					subtitle="Users with verified email addresses"
					icon={<UserCheck className="h-4 w-4" />}
					accent="green"
				/>
				<MetricCard
					label="Paying Customers"
					value={numberFormatter.format(metrics.payingCustomers)}
					subtitle="Organizations with completed transactions"
					icon={<ShieldCheck className="h-4 w-4" />}
					accent="purple"
				/>
				<MetricCard
					label="Total Revenue"
					value={currencyFormatter.format(metrics.totalRevenue)}
					subtitle="All completed payments"
					icon={<CircleDollarSign className="h-4 w-4" />}
					accent="green"
				/>
				<MetricCard
					label="Total Organizations"
					value={numberFormatter.format(metrics.totalOrganizations)}
					subtitle="All registered organizations"
					icon={<Building2 className="h-4 w-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Total Topped Up"
					value={currencyFormatter.format(metrics.totalToppedUp)}
					subtitle="All-time credits purchased"
					icon={<ArrowDownToLine className="h-4 w-4" />}
					accent="green"
				/>
				<MetricCard
					label="Total Spent"
					value={currencyFormatter.format(metrics.totalSpent)}
					subtitle="All-time usage costs"
					icon={<ArrowUpFromLine className="h-4 w-4" />}
					accent="purple"
				/>
				<MetricCard
					label="Unused Credits"
					value={currencyFormatter.format(metrics.unusedCredits)}
					subtitle="Credits sitting unused across all orgs"
					icon={<PiggyBank className="h-4 w-4" />}
					accent="blue"
				/>
				{metrics.overage > 0 && (
					<MetricCard
						label="Overage"
						value={currencyFormatter.format(metrics.overage)}
						subtitle="Spending exceeding topped-up credits"
						icon={<AlertTriangle className="h-4 w-4" />}
						accent="red"
					/>
				)}
			</section>

			{timeseries ? (
				<section className="grid gap-6 lg:grid-cols-2">
					<SignupsChart
						data={timeseries.data}
						totals={{
							signups: timeseries.totals.signups,
							paidCustomers: timeseries.totals.paidCustomers,
						}}
					/>
					<RevenueChart
						data={timeseries.data}
						totalRevenue={timeseries.totals.revenue}
					/>
				</section>
			) : null}

			<div className="mt-4">
				<Button asChild>
					<Link href="/organizations">View Organizations</Link>
				</Button>
			</div>
		</div>
	);
}
