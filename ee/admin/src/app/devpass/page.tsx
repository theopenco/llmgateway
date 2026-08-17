import { Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DateRangePicker } from "@/components/date-range-picker";
import { DevpassKpis } from "@/components/devpass-kpis";
import {
	DevpassResultCount,
	DevpassSubscribersTable,
} from "@/components/devpass-subscribers-table";
import { DevpassTimeseriesChart } from "@/components/devpass-timeseries-chart";
import { DevpassUsage } from "@/components/devpass-usage";
import { Button } from "@/components/ui/button";
import { resolveDateRange } from "@/lib/date-range";
import { requireSession } from "@/lib/require-session";
import { cn } from "@/lib/utils";

import type { DevpassListQuery } from "@/components/devpass-subscribers-table";

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
	"paygBalance",
	"allTimeTopUps",
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

// Nothing is fetched server-side: the KPI strip, the chart, the usage cards and
// the subscriber table each load independently on the client, so the shell
// (header, filters) paints immediately instead of waiting on the slowest query.
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

	const listQuery: DevpassListQuery = {
		limit,
		offset,
		search: search || undefined,
		tier: tier || undefined,
		status: status || undefined,
		utilization: utilization || undefined,
		marginNegative: marginNegative || undefined,
		// Omitted rather than sent as `false`: the query string carries the
		// literal "false", and the route's `z.coerce.boolean()` reads any
		// non-empty string as true. Absent falls through to its `false` default.
		showChurned: showChurned || undefined,
		sortBy,
		sortOrder,
	};

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

			<DevpassKpis from={from} to={to} />

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
							placeholder="Search by org name, email, owner, username, or ID..."
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
				<DevpassResultCount query={listQuery} />
			</form>

			<DevpassSubscribersTable
				query={listQuery}
				queryString={queryString}
				page={page}
				limit={limit}
			/>
		</div>
	);
}
