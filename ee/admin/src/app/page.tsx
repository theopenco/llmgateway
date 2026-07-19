import {
	AlertTriangle,
	ArrowUpRight,
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

import type { CSSProperties, ReactNode } from "react";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

type Accent = "green" | "blue" | "violet" | "amber" | "teal";

const accentTick: Record<Accent, string> = {
	green: "bg-emerald-500 dark:bg-emerald-400",
	blue: "bg-sky-500 dark:bg-sky-400",
	violet: "bg-violet-500 dark:bg-violet-400",
	amber: "bg-amber-500 dark:bg-amber-400",
	teal: "bg-teal-500 dark:bg-teal-400",
};

const accentIcon: Record<Accent, string> = {
	green: "text-emerald-600 dark:text-emerald-400",
	blue: "text-sky-600 dark:text-sky-400",
	violet: "text-violet-600 dark:text-violet-400",
	amber: "text-amber-600 dark:text-amber-400",
	teal: "text-teal-600 dark:text-teal-400",
};

function revealAt(index: number): CSSProperties {
	return { "--reveal-index": index } as CSSProperties;
}

/** Split "$1,234.56" into ["$1,234", ".56"] so cents can be de-emphasized. */
function splitCents(formatted: string): [string, string] {
	const dot = formatted.lastIndexOf(".");
	if (dot === -1) {
		return [formatted, ""];
	}
	return [formatted.slice(0, dot), formatted.slice(dot)];
}

/** Step the value type size down as the figure grows so it never overflows. */
function valueSizeClass(length: number, hero: boolean): string {
	if (hero) {
		if (length > 17) {
			return "text-2xl lg:text-3xl";
		}
		if (length > 13) {
			return "text-3xl lg:text-4xl";
		}
		return "text-4xl lg:text-5xl";
	}
	if (length > 16) {
		return "text-xl";
	}
	if (length > 13) {
		return "text-2xl";
	}
	return "text-[2rem]";
}

function SectionHeader({
	index,
	title,
	action,
}: {
	index: string;
	title: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex items-center gap-3">
			<span className="font-mono text-[11px] tabular-nums tracking-widest text-muted-foreground/60">
				{index}
			</span>
			<h2 className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
				{title}
			</h2>
			<span aria-hidden className="h-px flex-1 bg-border/70" />
			{action}
		</div>
	);
}

function LedgerRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
			<dt className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
				{label}
			</dt>
			<span
				aria-hidden
				className="min-w-3 flex-1 self-end border-b border-dotted border-foreground/20 pb-1"
			/>
			<dd className="ml-auto font-mono text-[13px] font-medium tabular-nums tracking-tight">
				{value}
			</dd>
		</div>
	);
}

function MetricCell({
	label,
	value,
	format,
	sublabel,
	icon,
	accent,
	rows,
	hero = false,
	className,
	style,
}: {
	label: string;
	value: number;
	format: "currency" | "count";
	sublabel: string;
	icon: ReactNode;
	accent: Accent;
	rows: { label: string; value: string }[];
	hero?: boolean;
	className?: string;
	style?: CSSProperties;
}) {
	const formatted =
		format === "currency"
			? currencyFormatter.format(value)
			: numberFormatter.format(value);
	const [main, cents] =
		format === "currency" ? splitCents(formatted) : [formatted, ""];

	return (
		<article
			className={cn(
				"reveal relative flex min-w-0 flex-col gap-5 bg-card p-5",
				className,
			)}
			style={style}
		>
			{hero ? (
				<div
					aria-hidden
					className="bg-dotgrid pointer-events-none absolute inset-0"
				/>
			) : null}
			<header className="relative flex items-center justify-between gap-3">
				<div className="flex items-center gap-2.5">
					<span
						aria-hidden
						className={cn("h-3 w-[3px] rounded-full", accentTick[accent])}
					/>
					<h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
						{label}
					</h3>
				</div>
				<span className={cn("shrink-0", accentIcon[accent])}>{icon}</span>
			</header>
			<div className="relative min-w-0">
				<p
					className={cn(
						"font-mono font-medium tabular-nums leading-none tracking-tight",
						valueSizeClass(formatted.length, hero),
					)}
				>
					{main}
					{cents ? (
						<span className="text-[0.6em] font-normal text-muted-foreground">
							{cents}
						</span>
					) : null}
				</p>
				<p className="mt-2.5 text-xs text-muted-foreground">{sublabel}</p>
			</div>
			<dl
				className={cn(
					"relative mt-auto border-t border-border/50 pt-4",
					hero
						? "grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2"
						: "flex flex-col gap-2",
				)}
			>
				{rows.map((row) => (
					<LedgerRow key={row.label} label={row.label} value={row.value} />
				))}
			</dl>
		</article>
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
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-10 px-4 py-8 md:px-8">
			<header
				className="reveal relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
				style={revealAt(0)}
			>
				<div
					aria-hidden
					className="bg-dotgrid pointer-events-none absolute -top-8 right-0 left-0 h-36"
				/>
				<div className="relative">
					<p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
						LLM Gateway{" "}
						<span aria-hidden className="text-foreground/30">
							/
						</span>{" "}
						Operations
					</p>
					<h1 className="mt-2.5 text-3xl font-semibold tracking-tight md:text-4xl">
						Admin Dashboard
					</h1>
					<p className="mt-1.5 text-sm text-muted-foreground">
						Users, customers, and revenue at a glance.
					</p>
				</div>
				<div className="relative flex items-center gap-3">
					<Suspense>
						<DateRangePicker />
					</Suspense>
					<div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
						<span className="relative flex h-1.5 w-1.5">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
							<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
						</span>
						<span>Live</span>
					</div>
				</div>
			</header>

			<section className="flex flex-col gap-4">
				<div className="reveal" style={revealAt(1)}>
					<SectionHeader index="01" title="Key metrics" />
				</div>
				<div className="panel-ticks">
					<div className="grid gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60 shadow-sm sm:grid-cols-2 xl:grid-cols-3">
						<MetricCell
							label="Total revenue"
							value={metrics.grossRevenue}
							format="currency"
							sublabel="Gross, all products — before fees & refunds"
							icon={<TrendingUp className="h-4 w-4" strokeWidth={1.75} />}
							accent="teal"
							hero
							className="sm:col-span-2"
							style={revealAt(2)}
							rows={[
								{
									label: "Credits",
									value: currencyFormatter.format(metrics.grossCreditsRevenue),
								},
								{
									label: "DevPass",
									value: currencyFormatter.format(metrics.grossDevpassRevenue),
								},
								{
									label: "Reset passes",
									value: currencyFormatter.format(
										metrics.grossResetPassRevenue,
									),
								},
								{
									label: "Chat plans",
									value: currencyFormatter.format(
										metrics.grossChatPlansRevenue,
									),
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
						<MetricCell
							label="Audience"
							value={metrics.totalSignups}
							format="count"
							sublabel="Total sign-ups"
							icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
							accent="blue"
							style={revealAt(3)}
							rows={[
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
						<MetricCell
							label="Credits revenue"
							value={metrics.totalRevenue - metrics.totalRefunds}
							format="currency"
							sublabel="Net credits — excl. Stripe fees & refunds"
							icon={<CircleDollarSign className="h-4 w-4" strokeWidth={1.75} />}
							accent="green"
							style={revealAt(4)}
							rows={[
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
						<MetricCell
							label="Credit flow"
							value={metrics.totalToppedUp}
							format="currency"
							sublabel="All-time credits purchased"
							icon={<PiggyBank className="h-4 w-4" strokeWidth={1.75} />}
							accent="violet"
							style={revealAt(5)}
							rows={[
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
						<MetricCell
							label="Credits given"
							value={metrics.totalGiftedCredits + metrics.totalBonusCredits}
							format="currency"
							sublabel="Free credits given — gift + SDK bonus"
							icon={<Gift className="h-4 w-4" strokeWidth={1.75} />}
							accent="amber"
							style={revealAt(6)}
							rows={[
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
					</div>
				</div>

				{metrics.overage > 0 && (
					<div
						className="reveal relative overflow-hidden rounded-xl border border-destructive/30 bg-destructive/5"
						style={revealAt(7)}
					>
						<div
							aria-hidden
							className="stripe-caution absolute inset-y-0 left-0 w-1.5"
						/>
						<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4 pr-5 pl-7">
							<div className="flex items-center gap-2.5 self-center">
								<AlertTriangle className="h-4 w-4 text-destructive" />
								<p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-destructive">
									Overage
								</p>
							</div>
							<p className="font-mono text-lg font-medium tabular-nums tracking-tight text-destructive">
								{currencyFormatter.format(metrics.overage)}
							</p>
							<p className="text-xs text-muted-foreground">
								Spending exceeding topped-up credits.
							</p>
						</div>
					</div>
				)}
			</section>

			{timeseries ? (
				<section className="flex flex-col gap-4">
					<div className="reveal" style={revealAt(7)}>
						<SectionHeader index="02" title="Growth & revenue" />
					</div>
					<div className="grid gap-6 lg:grid-cols-2">
						<div className="reveal" style={revealAt(8)}>
							<SignupsChart
								data={timeseries.data}
								totals={{
									signups: timeseries.totals.signups,
									paidCustomers: timeseries.totals.paidCustomers,
								}}
							/>
						</div>
						<div className="reveal" style={revealAt(9)}>
							<RevenueChart
								data={timeseries.data}
								totals={{
									credits: timeseries.totals.net,
									devpass: timeseries.totals.devpassNet,
								}}
							/>
						</div>
					</div>
				</section>
			) : null}

			<section className="flex flex-col gap-4">
				<div className="reveal" style={revealAt(10)}>
					<SectionHeader
						index="03"
						title="Cost by model"
						action={
							<Link
								href="/organizations"
								className="group flex shrink-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
							>
								View organizations
								<ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
							</Link>
						}
					/>
				</div>
				<div className="reveal" style={revealAt(11)}>
					<DashboardCostByModel from={from} to={to} />
				</div>
			</section>
		</div>
	);
}
