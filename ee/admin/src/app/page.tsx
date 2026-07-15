import {
	AlertTriangle,
	CircleDollarSign,
	Gift,
	PiggyBank,
	TrendingUp,
	Users,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { DashboardCostByModel } from "@/components/dashboard-cost-by-model";
import { DateRangePicker } from "@/components/date-range-picker";
import { RevenueChart } from "@/components/revenue-chart";
import { SignupsChart } from "@/components/signups-chart";
import { Button } from "@/components/ui/button";
import { resolveDateRangeFromSearchParams } from "@/lib/date-range";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";
import { cn } from "@/lib/utils";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 0,
	maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

type Accent = "green" | "blue" | "purple" | "red" | "amber" | "teal";

const accentRing: Record<Accent, string> = {
	green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
	blue: "border-sky-500/30 bg-sky-500/10 text-sky-400",
	purple: "border-violet-500/30 bg-violet-500/10 text-violet-400",
	red: "border-red-500/30 bg-red-500/10 text-red-400",
	amber: "border-amber-500/30 bg-amber-500/10 text-amber-400",
	teal: "border-teal-500/30 bg-teal-500/10 text-teal-400",
};

function GroupedMetricCard({
	label,
	value,
	subtitle,
	icon,
	accent,
	stats,
}: {
	label: string;
	value: string;
	subtitle?: string;
	icon: React.ReactNode;
	accent: Accent;
	stats: { label: string; value: string }[];
}) {
	return (
		<div className="bg-card text-card-foreground flex flex-col gap-5 rounded-xl border border-border/60 p-5 shadow-sm">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{label}
					</p>
					<p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
					{subtitle ? (
						<p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
					) : null}
				</div>
				<div
					className={cn(
						"inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs",
						accentRing[accent],
					)}
				>
					{icon}
				</div>
			</div>
			<div
				className={cn(
					"grid gap-4 border-t border-border/50 pt-4",
					stats.length === 3 ? "grid-cols-3" : "grid-cols-2",
				)}
			>
				{stats.map((stat) => (
					<div key={stat.label} className="min-w-0">
						<p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
							{stat.label}
						</p>
						<p className="mt-1 truncate text-sm font-semibold tabular-nums">
							{stat.value}
						</p>
					</div>
				))}
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

export default async function Page({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	await requireSession();

	const params = await searchParams;
	const { from, to } = resolveDateRangeFromSearchParams(params);

	const $api = await createServerApiClient();
	const [metricsRes, timeseriesRes] = await Promise.all([
		$api.GET("/admin/metrics", { params: { query: { from, to } } }),
		$api.GET("/admin/metrics/timeseries", {
			params: { query: { from, to } },
		}),
	]);
	const metrics = metricsRes.data;
	const timeseries = timeseriesRes.data;

	if (!metrics) {
		return <SignInPrompt />;
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
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
						<DateRangePicker />
					</Suspense>
					<div className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
						<span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
						<span>Live data</span>
					</div>
				</div>
			</header>

			<section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
				<GroupedMetricCard
					label="Audience"
					value={numberFormatter.format(metrics.totalSignups)}
					subtitle="Total sign-ups"
					icon={<Users className="h-4 w-4" />}
					accent="blue"
					stats={[
						{
							label: "Verified",
							value: numberFormatter.format(metrics.verifiedUsers),
						},
						{
							label: "Paying",
							value: numberFormatter.format(metrics.payingCustomers),
						},
						{
							label: "Orgs",
							value: numberFormatter.format(metrics.totalOrganizations),
						},
					]}
				/>
				<GroupedMetricCard
					label="Total Revenue"
					value={currencyFormatter.format(metrics.grossRevenue)}
					subtitle="Gross, all products (before fees & refunds)"
					icon={<TrendingUp className="h-4 w-4" />}
					accent="teal"
					stats={[
						{
							label: "Credits",
							value: currencyFormatter.format(metrics.grossCreditsRevenue),
						},
						{
							label: "DevPass",
							value: currencyFormatter.format(metrics.grossDevpassRevenue),
						},
						{
							label: "Chat plans",
							value: currencyFormatter.format(metrics.grossChatPlansRevenue),
						},
						...(metrics.grossProSubscriptionsRevenue > 0
							? [
									{
										label: "Pro subs",
										value: currencyFormatter.format(
											metrics.grossProSubscriptionsRevenue,
										),
									},
								]
							: []),
					]}
				/>
				<GroupedMetricCard
					label="Credits Revenue"
					value={currencyFormatter.format(
						metrics.totalRevenue - metrics.totalRefunds,
					)}
					subtitle="Net credits (excl. Stripe fees & refunds)"
					icon={<CircleDollarSign className="h-4 w-4" />}
					accent="green"
					stats={[
						{
							label: "Processed",
							value: currencyFormatter.format(metrics.totalProcessed),
						},
						{
							label: "Fees",
							value: currencyFormatter.format(
								Math.max(0, metrics.totalProcessed - metrics.totalRevenue),
							),
						},
						{
							label: "Refunds",
							value: currencyFormatter.format(metrics.totalRefunds),
						},
					]}
				/>
				<GroupedMetricCard
					label="Credit Flow"
					value={currencyFormatter.format(metrics.totalToppedUp)}
					subtitle="All-time credits purchased"
					icon={<PiggyBank className="h-4 w-4" />}
					accent="purple"
					stats={[
						{
							label: "Spent",
							value: currencyFormatter.format(metrics.totalSpent),
						},
						{
							label: "Unused",
							value: currencyFormatter.format(metrics.unusedCredits),
						},
					]}
				/>
				<GroupedMetricCard
					label="Credits Given"
					value={currencyFormatter.format(
						metrics.totalGiftedCredits + metrics.totalBonusCredits,
					)}
					subtitle="Free credits given (gift + SDK bonus)"
					icon={<Gift className="h-4 w-4" />}
					accent="amber"
					stats={[
						{
							label: "Gifted",
							value: currencyFormatter.format(metrics.totalGiftedCredits),
						},
						{
							label: "SDK bonus",
							value: currencyFormatter.format(metrics.totalBonusCredits),
						},
					]}
				/>
			</section>

			{metrics.overage > 0 && (
				<div className="flex items-center justify-between gap-4 rounded-xl border border-red-500/30 bg-red-500/5 px-5 py-4">
					<div className="flex items-center gap-3">
						<div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 text-red-400">
							<AlertTriangle className="h-4 w-4" />
						</div>
						<div>
							<p className="text-sm font-medium">
								Overage:{" "}
								<span className="font-semibold text-red-400 tabular-nums">
									{currencyFormatter.format(metrics.overage)}
								</span>
							</p>
							<p className="text-xs text-muted-foreground">
								Spending exceeding topped-up credits.
							</p>
						</div>
					</div>
				</div>
			)}

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
						totalNet={timeseries.totals.net}
					/>
				</section>
			) : null}

			<section>
				<DashboardCostByModel from={from} to={to} />
			</section>

			<div className="mt-4">
				<Button asChild>
					<Link href="/organizations">View Organizations</Link>
				</Button>
			</div>
		</div>
	);
}
