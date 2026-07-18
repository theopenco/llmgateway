import {
	AlertCircle,
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	Info,
	RotateCcw,
	Search,
	Ticket,
	TrendingDown,
	TrendingUp,
	Users,
	Wallet,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DateRangePicker } from "@/components/date-range-picker";
import { DevpassTimeseriesChart } from "@/components/devpass-timeseries-chart";
import { DevpassUsage } from "@/components/devpass-usage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { resolveDateRange } from "@/lib/date-range";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";
import { cn } from "@/lib/utils";

const SORT_BY_VALUES = [
	"name",
	"billingEmail",
	"tier",
	"createdAt",
	"cycleStart",
	"expiresAt",
	"subscribedSince",
	"utilizationPct",
	"realCost",
	"margin",
	"mrr",
	"creditsUsed",
	"allTimeRevenue",
	"allTimeCost",
	"allTimeMargin",
] as const;
type SortBy = (typeof SORT_BY_VALUES)[number];

const SORT_ORDER_VALUES = ["asc", "desc"] as const;
type SortOrder = (typeof SORT_ORDER_VALUES)[number];

const TIER_VALUES = ["lite", "pro", "max", "none"] as const;
type TierFilter = (typeof TIER_VALUES)[number] | "";

const STATUS_VALUES = [
	"active",
	"cancelled_pending",
	"expired",
	"churned",
] as const;
type StatusFilter = (typeof STATUS_VALUES)[number] | "";

const UTIL_VALUES = ["low", "healthy", "high", "over"] as const;
type UtilFilter = (typeof UTIL_VALUES)[number] | "";

function pickEnum<T extends readonly string[]>(
	allowed: T,
	raw: string | undefined,
	fallback: T[number] | "",
): T[number] | "" {
	if (!raw) {
		return fallback;
	}
	return (allowed as readonly string[]).includes(raw)
		? (raw as T[number])
		: fallback;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

const currencyFormatterPrecise = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

function formatDate(dateString: string | null) {
	if (!dateString) {
		return "—";
	}
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function getTierBadgeVariant(
	tier: string,
): "default" | "secondary" | "outline" {
	switch (tier) {
		case "max":
			return "default";
		case "pro":
			return "secondary";
		case "lite":
			return "outline";
		default:
			return "outline";
	}
}

function getStatusBadgeVariant(
	status: string,
): "default" | "secondary" | "outline" | "destructive" {
	switch (status) {
		case "active":
			return "secondary";
		case "cancelled_pending":
			return "outline";
		case "expired":
			return "destructive";
		case "churned":
			return "outline";
		default:
			return "outline";
	}
}

function formatStatus(status: string) {
	if (status === "cancelled_pending") {
		return "cancel pending";
	}
	return status;
}

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	queryString,
}: {
	label: string;
	sortKey: SortBy;
	currentSortBy: SortBy;
	currentSortOrder: SortOrder;
	queryString: string;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "asc" ? "desc" : "asc";

	const baseParams = new URLSearchParams(queryString);
	baseParams.set("sortBy", sortKey);
	baseParams.set("sortOrder", nextOrder);
	baseParams.set("page", "1");
	const href = `/devpass?${baseParams.toString()}`;

	return (
		<Link
			href={href}
			className={cn(
				"flex items-center gap-1 hover:text-foreground transition-colors",
				isActive ? "text-foreground" : "text-muted-foreground",
			)}
		>
			{label}
			{isActive ? (
				currentSortOrder === "asc" ? (
					<ArrowUp className="h-3.5 w-3.5" />
				) : (
					<ArrowDown className="h-3.5 w-3.5" />
				)
			) : (
				<ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
			)}
		</Link>
	);
}

function UtilBar({ pct }: { pct: number | null }) {
	if (pct === null) {
		return <span className="text-muted-foreground">—</span>;
	}
	const clamped = Math.min(100, Math.max(0, pct));
	const tone =
		pct < 20
			? "bg-amber-500"
			: pct > 100
				? "bg-rose-500"
				: pct > 80
					? "bg-orange-500"
					: "bg-emerald-500";
	return (
		<div className="flex items-center gap-2">
			<div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
				<div className={cn("h-full", tone)} style={{ width: `${clamped}%` }} />
			</div>
			<span className="tabular-nums text-xs text-muted-foreground">
				{pct.toFixed(0)}%
			</span>
		</div>
	);
}

function FilterPill({
	label,
	value,
	currentValue,
	queryString,
	paramName,
}: {
	label: string;
	value: string;
	currentValue: string;
	queryString: string;
	paramName: string;
}) {
	const params = new URLSearchParams(queryString);
	if (currentValue === value) {
		params.delete(paramName);
	} else {
		params.set(paramName, value);
	}
	params.set("page", "1");
	const isActive = currentValue === value;
	return (
		<Link
			href={`/devpass?${params.toString()}`}
			className={cn(
				"inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors",
				isActive
					? "border-foreground bg-foreground text-background"
					: "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
			)}
		>
			{label}
		</Link>
	);
}

function ToggleLink({
	label,
	value,
	queryString,
	paramName,
}: {
	label: string;
	value: boolean;
	queryString: string;
	paramName: string;
}) {
	const params = new URLSearchParams(queryString);
	if (value) {
		params.delete(paramName);
	} else {
		params.set(paramName, "true");
	}
	params.set("page", "1");
	return (
		<Link
			href={`/devpass?${params.toString()}`}
			className={cn(
				"inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors",
				value
					? "border-foreground bg-foreground text-background"
					: "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
			)}
		>
			{label}
		</Link>
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

export default async function DevpassPage({
	searchParams,
}: {
	searchParams?: Promise<{
		page?: string;
		search?: string;
		sortBy?: string;
		sortOrder?: string;
		tier?: string;
		status?: string;
		utilization?: string;
		marginNegative?: string;
		showChurned?: string;
		range?: string;
		from?: string;
		to?: string;
	}>;
}) {
	await requireSession();

	const params = await searchParams;
	const range = typeof params?.range === "string" ? params?.range : undefined;
	const { from, to } = resolveDateRange({
		range,
		from: params?.from,
		to: params?.to,
	});
	const rawPage = parseInt(params?.page ?? "1", 10);
	const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
	const search = params?.search ?? "";
	const sortBy =
		(pickEnum(SORT_BY_VALUES, params?.sortBy, "subscribedSince") as SortBy) ||
		"subscribedSince";
	const sortOrder =
		(pickEnum(SORT_ORDER_VALUES, params?.sortOrder, "desc") as SortOrder) ||
		"desc";
	const tier = pickEnum(TIER_VALUES, params?.tier, "") as TierFilter;
	const status = pickEnum(STATUS_VALUES, params?.status, "") as StatusFilter;
	const utilization = pickEnum(
		UTIL_VALUES,
		params?.utilization,
		"",
	) as UtilFilter;
	const marginNegative = params?.marginNegative === "true";
	const showChurned = params?.showChurned === "true";
	const limit = 25;
	const offset = (page - 1) * limit;

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/devpass", {
		params: {
			query: {
				limit,
				offset,
				search: search || undefined,
				tier: tier || undefined,
				status: status || undefined,
				utilization: utilization || undefined,
				marginNegative: marginNegative || undefined,
				showChurned,
				sortBy,
				sortOrder,
			},
		},
	});

	if (!data) {
		return <SignInPrompt />;
	}

	const totalPages = Math.ceil(data.total / limit);

	const queryParams = new URLSearchParams();
	if (search) {
		queryParams.set("search", search);
	}
	if (tier) {
		queryParams.set("tier", tier);
	}
	if (status) {
		queryParams.set("status", status);
	}
	if (utilization) {
		queryParams.set("utilization", utilization);
	}
	if (marginNegative) {
		queryParams.set("marginNegative", "true");
	}
	if (showChurned) {
		queryParams.set("showChurned", "true");
	}
	if (range) {
		queryParams.set("range", range);
	} else {
		if (from) {
			queryParams.set("from", from);
		}
		if (to) {
			queryParams.set("to", to);
		}
	}
	queryParams.set("sortBy", sortBy);
	queryParams.set("sortOrder", sortOrder);
	const queryString = queryParams.toString();

	async function handleSearch(formData: FormData) {
		"use server";
		const searchValue = formData.get("search") as string;
		const sortByValue = formData.get("sortBy") as string;
		const sortOrderValue = formData.get("sortOrder") as string;
		const tierValue = formData.get("tier") as string;
		const statusValue = formData.get("status") as string;
		const utilValue = formData.get("utilization") as string;
		const marginValue = formData.get("marginNegative") as string;
		const churnValue = formData.get("showChurned") as string;
		const rangeValue = formData.get("range") as string;
		const fromValue = formData.get("from") as string;
		const toValue = formData.get("to") as string;
		const sp = new URLSearchParams();
		if (searchValue) {
			sp.set("search", searchValue);
		}
		if (tierValue) {
			sp.set("tier", tierValue);
		}
		if (statusValue) {
			sp.set("status", statusValue);
		}
		if (utilValue) {
			sp.set("utilization", utilValue);
		}
		if (marginValue) {
			sp.set("marginNegative", "true");
		}
		if (churnValue) {
			sp.set("showChurned", "true");
		}
		if (rangeValue) {
			sp.set("range", rangeValue);
		} else {
			if (fromValue) {
				sp.set("from", fromValue);
			}
			if (toValue) {
				sp.set("to", toValue);
			}
		}
		sp.set("sortBy", sortByValue);
		sp.set("sortOrder", sortOrderValue);
		sp.set("page", "1");
		redirect(`/devpass?${sp.toString()}`);
	}

	const kpis = data.kpis;
	const grossMrrAfterRefunds = kpis.grossMrr - kpis.refundedAmountThisMonth;

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div className="space-y-2">
					<h1 className="text-3xl font-semibold tracking-tight">DevPass</h1>
					<p className="text-sm text-muted-foreground">
						Subscribers across Lite, Pro and Max — current cycle utilization,
						real provider cost, and margin.
					</p>
				</div>
				<Suspense>
					<DateRangePicker />
				</Suspense>
			</header>

			<section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
				<div className="rounded-lg border border-border/60 bg-card p-4">
					<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
						<Users className="h-3.5 w-3.5" />
						Active subscribers
					</div>
					<div className="mt-2 text-2xl font-semibold tabular-nums">
						{kpis.totalActive}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						Lite {kpis.activeByTier.lite} · Pro {kpis.activeByTier.pro} · Max{" "}
						{kpis.activeByTier.max}
						{kpis.cancelledPending > 0 ? (
							<>
								{" "}
								·{" "}
								<span className="text-amber-600 dark:text-amber-400">
									{kpis.cancelledPending} cancelling
								</span>
							</>
						) : null}
					</div>
				</div>
				<div className="rounded-lg border border-border/60 bg-card p-4">
					<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
						<Wallet className="h-3.5 w-3.5" />
						Gross MRR
					</div>
					<div className="mt-2 flex items-baseline gap-2">
						<span className="text-2xl font-semibold tabular-nums">
							{currencyFormatter.format(kpis.grossMrr)}
						</span>
						<Tooltip>
							<TooltipTrigger asChild>
								<span
									className={cn(
										"inline-flex cursor-help items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums",
										kpis.committedMrr !== kpis.grossMrr
											? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
											: "border-border/60 bg-muted/40 text-muted-foreground",
									)}
								>
									<Info className="h-3 w-3" />
									{currencyFormatter.format(kpis.committedMrr)} committed
								</span>
							</TooltipTrigger>
							<TooltipContent className="max-w-xs">
								Forward-looking MRR after pending churn. Excludes subs flagged
								to cancel at period end (still billed by Stripe this cycle, but
								gone next cycle).
							</TooltipContent>
						</Tooltip>
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						Net after refunds this month:{" "}
						<span
							className={cn(
								"font-medium tabular-nums",
								grossMrrAfterRefunds < kpis.grossMrr
									? "text-rose-600 dark:text-rose-400"
									: "",
							)}
						>
							{currencyFormatter.format(grossMrrAfterRefunds)}
						</span>
						{kpis.refundedAmountThisMonth > 0 ? (
							<>
								{" "}
								after {currencyFormatter.format(
									kpis.refundedAmountThisMonth,
								)}{" "}
								refunded
							</>
						) : null}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						Net new this month:{" "}
						<span
							className={cn(
								"font-medium",
								kpis.netNewThisMonth > 0
									? "text-emerald-600 dark:text-emerald-400"
									: kpis.netNewThisMonth < 0
										? "text-rose-600 dark:text-rose-400"
										: "",
							)}
						>
							{kpis.netNewThisMonth > 0 ? "+" : ""}
							{kpis.netNewThisMonth}
						</span>{" "}
						({kpis.startsThisMonth} starts / {kpis.endsThisMonth} ends)
					</div>
				</div>
				<div className="rounded-lg border border-border/60 bg-card p-4">
					<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
						<RotateCcw className="h-3.5 w-3.5" />
						Refunds this month
					</div>
					<div
						className={cn(
							"mt-2 text-2xl font-semibold tabular-nums",
							kpis.refundedAmountThisMonth > 0
								? "text-rose-600 dark:text-rose-400"
								: "",
						)}
					>
						{currencyFormatter.format(kpis.refundedAmountThisMonth)}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						{kpis.refundsThisMonth} refund
						{kpis.refundsThisMonth === 1 ? "" : "s"} processed
					</div>
				</div>
				<div className="rounded-lg border border-border/60 bg-card p-4">
					<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
						<Ticket className="h-3.5 w-3.5" />
						Reset passes sold
					</div>
					<div className="mt-2 text-2xl font-semibold tabular-nums">
						{kpis.resetPassesSold}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						{currencyFormatter.format(kpis.resetPassRevenue)} all-time revenue
					</div>
				</div>
				<div className="rounded-lg border border-border/60 bg-card p-4">
					<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
						<TrendingUp className="h-3.5 w-3.5" />
						Avg utilization
					</div>
					<div className="mt-2 text-2xl font-semibold tabular-nums">
						{kpis.weightedAvgUtilization.toFixed(1)}%
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						Weighted across active subs
					</div>
				</div>
				<div className="rounded-lg border border-border/60 bg-card p-4">
					<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
						{kpis.totalMargin >= 0 ? (
							<TrendingUp className="h-3.5 w-3.5" />
						) : (
							<TrendingDown className="h-3.5 w-3.5" />
						)}
						Cycle margin
					</div>
					<div className="mt-2 flex items-baseline gap-2">
						<span
							className={cn(
								"text-2xl font-semibold tabular-nums",
								kpis.totalMargin < 0 ? "text-rose-600 dark:text-rose-400" : "",
							)}
						>
							{currencyFormatter.format(kpis.totalMargin)}
						</span>
						{kpis.marginPct !== null && kpis.marginPct !== undefined ? (
							<span
								className={cn(
									"rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums",
									kpis.marginPct < 0
										? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
										: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
								)}
								title="Profit margin: cycle margin / gross MRR"
							>
								{kpis.marginPct.toFixed(1)}% profit
							</span>
						) : null}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						{currencyFormatter.format(kpis.totalRealCostCycle)} provider cost
						this cycle
					</div>
				</div>
			</section>

			<DevpassTimeseriesChart from={from} to={to} />

			<DevpassUsage from={from} to={to} />

			<form
				action={handleSearch}
				className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card p-4"
			>
				<input type="hidden" name="sortBy" value={sortBy} />
				<input type="hidden" name="sortOrder" value={sortOrder} />
				<input type="hidden" name="tier" value={tier} />
				<input type="hidden" name="status" value={status} />
				<input type="hidden" name="utilization" value={utilization} />
				<input
					type="hidden"
					name="marginNegative"
					value={marginNegative ? "true" : ""}
				/>
				<input
					type="hidden"
					name="showChurned"
					value={showChurned ? "true" : ""}
				/>
				<input type="hidden" name="range" value={range ?? ""} />
				<input type="hidden" name="from" value={range ? "" : (from ?? "")} />
				<input type="hidden" name="to" value={range ? "" : (to ?? "")} />
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
					<div className="relative flex-1">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							name="search"
							placeholder="Search by org name, email, owner, or ID..."
							defaultValue={search}
							className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>
					<Button type="submit" size="sm">
						Search
					</Button>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs uppercase tracking-wide text-muted-foreground">
						Tier
					</span>
					<FilterPill
						label="Lite"
						value="lite"
						currentValue={tier}
						queryString={queryString}
						paramName="tier"
					/>
					<FilterPill
						label="Pro"
						value="pro"
						currentValue={tier}
						queryString={queryString}
						paramName="tier"
					/>
					<FilterPill
						label="Max"
						value="max"
						currentValue={tier}
						queryString={queryString}
						paramName="tier"
					/>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs uppercase tracking-wide text-muted-foreground">
						Status
					</span>
					<FilterPill
						label="Active"
						value="active"
						currentValue={status}
						queryString={queryString}
						paramName="status"
					/>
					<FilterPill
						label="Cancel pending"
						value="cancelled_pending"
						currentValue={status}
						queryString={queryString}
						paramName="status"
					/>
					<FilterPill
						label="Expired"
						value="expired"
						currentValue={status}
						queryString={queryString}
						paramName="status"
					/>
					<FilterPill
						label="Churned"
						value="churned"
						currentValue={status}
						queryString={queryString}
						paramName="status"
					/>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs uppercase tracking-wide text-muted-foreground">
						Utilization
					</span>
					<FilterPill
						label="< 20%"
						value="low"
						currentValue={utilization}
						queryString={queryString}
						paramName="utilization"
					/>
					<FilterPill
						label="20–80%"
						value="healthy"
						currentValue={utilization}
						queryString={queryString}
						paramName="utilization"
					/>
					<FilterPill
						label="80–100%"
						value="high"
						currentValue={utilization}
						queryString={queryString}
						paramName="utilization"
					/>
					<FilterPill
						label="Over cap"
						value="over"
						currentValue={utilization}
						queryString={queryString}
						paramName="utilization"
					/>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs uppercase tracking-wide text-muted-foreground">
						Other
					</span>
					<ToggleLink
						label="Negative margin only"
						value={marginNegative}
						queryString={queryString}
						paramName="marginNegative"
					/>
					<ToggleLink
						label="Show churned"
						value={showChurned}
						queryString={queryString}
						paramName="showChurned"
					/>
				</div>
				<p className="text-xs text-muted-foreground">
					{data.total} subscriber{data.total === 1 ? "" : "s"} match current
					filters
				</p>
			</form>

			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>
								<SortableHeader
									label="Subscriber"
									sortKey="name"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									queryString={queryString}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Tier"
									sortKey="tier"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									queryString={queryString}
								/>
							</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>
								<SortableHeader
									label="Utilization"
									sortKey="utilizationPct"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									queryString={queryString}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Cycle"
									sortKey="cycleStart"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									queryString={queryString}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Renews"
									sortKey="expiresAt"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									queryString={queryString}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="MRR"
									sortKey="mrr"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									queryString={queryString}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Real cost"
									sortKey="realCost"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									queryString={queryString}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Margin"
									sortKey="margin"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									queryString={queryString}
								/>
							</TableHead>
							<TableHead>Premium (week)</TableHead>
							<TableHead>
								<SortableHeader
									label="Cost (all-time)"
									sortKey="allTimeCost"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									queryString={queryString}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Margin (all-time)"
									sortKey="allTimeMargin"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									queryString={queryString}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Since"
									sortKey="subscribedSince"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									queryString={queryString}
								/>
							</TableHead>
							<TableHead>Δ tier</TableHead>
							<TableHead>Payments</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.subscribers.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={15}
									className="h-24 text-center text-muted-foreground"
								>
									No subscribers match
								</TableCell>
							</TableRow>
						) : (
							data.subscribers.map((sub) => (
								<TableRow key={sub.id}>
									<TableCell>
										<Link
											href={`/devpass/${sub.id}`}
											className="font-medium text-foreground hover:underline"
										>
											{sub.name}
										</Link>
										<p className="text-xs text-muted-foreground">
											{sub.ownerEmail ?? sub.billingEmail}
										</p>
									</TableCell>
									<TableCell>
										<Badge variant={getTierBadgeVariant(sub.tier)}>
											{sub.tier}
										</Badge>
										{sub.pendingTier && (
											<p className="mt-1 text-xs text-amber-600">
												→ {sub.pendingTier} next cycle
											</p>
										)}
									</TableCell>
									<TableCell>
										<Badge variant={getStatusBadgeVariant(sub.status)}>
											{formatStatus(sub.status)}
										</Badge>
									</TableCell>
									<TableCell>
										<UtilBar pct={sub.utilizationPct} />
										<p className="mt-1 text-xs tabular-nums text-muted-foreground">
											{currencyFormatter.format(parseFloat(sub.creditsUsed))} /{" "}
											{currencyFormatter.format(parseFloat(sub.creditsLimit))}
										</p>
									</TableCell>
									<TableCell className="text-muted-foreground text-xs">
										{sub.cycleDaysIn !== null ? `Day ${sub.cycleDaysIn}` : "—"}
									</TableCell>
									<TableCell className="text-muted-foreground text-xs">
										{sub.expiresAt ? formatDate(sub.expiresAt) : "—"}
									</TableCell>
									<TableCell className="tabular-nums">
										{currencyFormatter.format(sub.mrr)}
									</TableCell>
									<TableCell className="tabular-nums text-muted-foreground">
										{currencyFormatterPrecise.format(sub.realCost)}
									</TableCell>
									<TableCell
										className={cn(
											"tabular-nums",
											sub.margin < 0
												? "text-rose-600 dark:text-rose-400"
												: "text-emerald-600 dark:text-emerald-400",
										)}
									>
										{currencyFormatter.format(sub.margin)}
									</TableCell>
									<TableCell className="tabular-nums text-xs">
										{(() => {
											const premUsed = parseFloat(sub.premiumCreditsUsed);
											const premLimit = parseFloat(sub.premiumCreditsLimit);
											if (premLimit <= 0) {
												return <span className="text-muted-foreground">—</span>;
											}
											const pct = Math.min(
												100,
												Math.max(0, (premUsed / premLimit) * 100),
											);
											const tone =
												pct >= 100
													? "text-rose-600 dark:text-rose-400"
													: pct >= 80
														? "text-orange-600 dark:text-orange-400"
														: "text-muted-foreground";
											return (
												<span className={tone}>
													{currencyFormatter.format(premUsed)} /{" "}
													{currencyFormatter.format(premLimit)}
												</span>
											);
										})()}
									</TableCell>
									<TableCell className="tabular-nums text-muted-foreground">
										{currencyFormatterPrecise.format(sub.allTimeCost)}
									</TableCell>
									<TableCell
										className={cn(
											"tabular-nums",
											sub.allTimeMargin < 0
												? "text-rose-600 dark:text-rose-400"
												: "text-emerald-600 dark:text-emerald-400",
										)}
										title={`Revenue ${currencyFormatter.format(
											sub.allTimeRevenue,
										)} − cost ${currencyFormatterPrecise.format(sub.allTimeCost)}`}
									>
										{currencyFormatter.format(sub.allTimeMargin)}
									</TableCell>
									<TableCell className="text-muted-foreground text-xs">
										{formatDate(sub.subscribedSince)}
									</TableCell>
									<TableCell className="tabular-nums text-muted-foreground text-xs">
										{sub.tierChanges}
									</TableCell>
									<TableCell>
										{sub.hasPaymentIssue ? (
											<Badge variant="destructive" className="gap-1">
												<AlertCircle className="h-3 w-3" />
												failed
											</Badge>
										) : (
											<span className="text-xs text-muted-foreground">ok</span>
										)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{totalPages > 1 && (
				<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm text-muted-foreground">
						Showing {offset + 1} to {Math.min(offset + limit, data.total)} of{" "}
						{data.total}
					</p>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" asChild disabled={page <= 1}>
							<Link
								href={`/devpass?${(() => {
									const sp = new URLSearchParams(queryString);
									sp.set("page", String(page - 1));
									return sp.toString();
								})()}`}
								className={page <= 1 ? "pointer-events-none opacity-50" : ""}
							>
								<ChevronLeft className="h-4 w-4" />
								Previous
							</Link>
						</Button>
						<span className="text-sm text-muted-foreground">
							Page {page} of {totalPages}
						</span>
						<Button
							variant="outline"
							size="sm"
							asChild
							disabled={page >= totalPages}
						>
							<Link
								href={`/devpass?${(() => {
									const sp = new URLSearchParams(queryString);
									sp.set("page", String(page + 1));
									return sp.toString();
								})()}`}
								className={
									page >= totalPages ? "pointer-events-none opacity-50" : ""
								}
							>
								Next
								<ChevronRight className="h-4 w-4" />
							</Link>
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
