"use client";

import { keepPreviousData } from "@tanstack/react-query";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronRight,
	Loader2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
	credentialErrorRate,
	formatErrorPercent,
	toneForFraction,
} from "@/components/provider-key-error-rate-cell";
import { SparklineBars } from "@/components/sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import {
	CARRIER_WINDOW_OPTIONS,
	carrierWindowOption,
	parseCarrierWindow,
	type CarrierWindow,
} from "@/lib/airside-carrier-window";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { formatNumber } from "@llmgateway/shared/number-format";

import type { paths } from "@/lib/api/v1";

type Carrier =
	paths["/admin/airside/routing-settings"]["get"]["responses"]["200"]["content"]["application/json"]["providers"][number];

type SortKey =
	| "name"
	| "routedCost"
	| "requestCount"
	| "errorRate"
	| "activeMappingCount"
	| "marginAmount30d";
type SortOrder = "asc" | "desc";

function formatPercent(fraction: number): string {
	return `${(fraction * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function formatUsd(amount: number): string {
	return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Null sorts last in either direction: a carrier with no traffic has no rate. */
function sortValue(carrier: Carrier, key: SortKey): number | string | null {
	switch (key) {
		case "name":
			return carrier.company.name.toLowerCase();
		case "errorRate":
			return credentialErrorRate(carrier).fraction;
		case "marginAmount30d":
			return carrier.marginAmount30d;
		default:
			return carrier[key];
	}
}

function sortCarriers(carriers: Carrier[], key: SortKey, order: SortOrder) {
	const dir = order === "asc" ? 1 : -1;
	return [...carriers].sort((a, b) => {
		const av = sortValue(a, key);
		const bv = sortValue(b, key);
		if (av !== bv) {
			if (av === null) {
				return 1;
			}
			if (bv === null) {
				return -1;
			}
			return av < bv ? -dir : dir;
		}
		return a.company.name.localeCompare(b.company.name);
	});
}

/**
 * Routing = active mappings and traffic in the window; idle = routable but
 * nothing served; inactive = no active mapping left.
 */
function CarrierStatus({ carrier }: { carrier: Carrier }) {
	if (carrier.status === "inactive") {
		return (
			<Badge
				variant="outline"
				title="No active mapping — the carrier cannot receive traffic."
			>
				Inactive
			</Badge>
		);
	}
	if (carrier.requestCount === 0) {
		return (
			<Badge
				variant="outline"
				className="text-amber-600 dark:text-amber-500"
				title="Has active mappings but served no requests in this window."
			>
				Idle
			</Badge>
		);
	}
	return <Badge variant="secondary">Routing</Badge>;
}

function bucketLabel(date: string, bucket: "hour" | "day") {
	return bucket === "hour"
		? `${date.slice(0, 10)} ${date.slice(11, 16)} UTC`
		: date.slice(0, 10);
}

function RoutedCostCell({
	carrier,
	bucket,
	window,
}: {
	carrier: Carrier;
	bucket: "hour" | "day";
	window: CarrierWindow;
}) {
	const { series } = carrier;
	return (
		<div className="flex flex-col items-end gap-1">
			<span className="tabular-nums">{formatUsd(carrier.routedCost)}</span>
			<div className="text-primary">
				<SparklineBars
					values={series.map((point) => point.cost)}
					points={series.map((point, index) => ({
						label: `${bucketLabel(point.date, bucket)}: $${point.cost.toFixed(2)}, ${formatNumber(point.requestCount)} requests${
							index === series.length - 1 ? " (still in progress)" : ""
						}`,
					}))}
					ariaLabel={`Routed cost per ${carrierWindowOption(window).bucket} over the ${carrierWindowOption(window).label}, totalling $${carrier.routedCost.toFixed(2)}`}
				/>
			</div>
		</div>
	);
}

function ErrorRateCell({ carrier }: { carrier: Carrier }) {
	const rate = credentialErrorRate(carrier);
	if (rate.fraction === null) {
		return (
			<span
				className="text-muted-foreground text-xs"
				title="No requests other than client errors in this window."
			>
				—
			</span>
		);
	}
	return (
		<span
			className={cn("tabular-nums text-sm", toneForFraction(rate.fraction))}
			title={`${formatNumber(carrier.gatewayErrorCount)} gateway + ${formatNumber(carrier.upstreamErrorCount)} upstream errors over ${formatNumber(rate.requestCount)} requests (${formatNumber(carrier.clientErrorCount)} client errors excluded)`}
		>
			{formatErrorPercent(rate.fraction)}
		</span>
	);
}

function SortableHead({
	label,
	sortKey,
	sort,
	onSort,
	align = "right",
}: {
	label: string;
	sortKey: SortKey;
	sort: { key: SortKey; order: SortOrder };
	onSort: (key: SortKey) => void;
	align?: "left" | "right";
}) {
	const isActive = sort.key === sortKey;
	return (
		<TableHead className={align === "right" ? "text-right" : undefined}>
			<button
				type="button"
				onClick={() => onSort(sortKey)}
				className={cn(
					"inline-flex items-center gap-1 transition-colors hover:text-foreground",
					isActive ? "text-foreground" : "text-muted-foreground",
				)}
			>
				{label}
				{isActive ? (
					sort.order === "asc" ? (
						<ArrowUp className="h-3.5 w-3.5" />
					) : (
						<ArrowDown className="h-3.5 w-3.5" />
					)
				) : (
					<ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
				)}
			</button>
		</TableHead>
	);
}

function CarrierTable({
	carriers,
	bucket,
	window,
	showMargin,
	sort,
	onSort,
}: {
	carriers: Carrier[];
	bucket: "hour" | "day";
	window: CarrierWindow;
	showMargin: boolean;
	sort: { key: SortKey; order: SortOrder };
	onSort: (key: SortKey) => void;
}) {
	const head = { sort, onSort };
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<SortableHead label="Company" sortKey="name" align="left" {...head} />
					<TableHead>Status</TableHead>
					<SortableHead
						label="Mappings"
						sortKey="activeMappingCount"
						{...head}
					/>
					<SortableHead
						label={`Routed (${window})`}
						sortKey="routedCost"
						{...head}
					/>
					<SortableHead label="Requests" sortKey="requestCount" {...head} />
					<SortableHead label="Error rate" sortKey="errorRate" {...head} />
					<TableHead className="text-right">Discount</TableHead>
					{showMargin && (
						<>
							<TableHead className="text-right">Margin</TableHead>
							<TableHead className="text-right">Routing adjustment</TableHead>
							<SortableHead
								label="Margin (30d)"
								sortKey="marginAmount30d"
								{...head}
							/>
							<TableHead className="text-right">Margin (total)</TableHead>
						</>
					)}
					<TableHead className="text-right">Updated</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{carriers.map((carrier) => (
					<TableRow
						key={carrier.providerId}
						data-testid={`carrier-${carrier.providerId}`}
					>
						<TableCell>
							<Link
								href={`/providers/${carrier.providerId}`}
								className="font-medium hover:underline"
							>
								{carrier.company.name}
							</Link>
							<div className="text-muted-foreground font-mono text-xs">
								{carrier.providerId}
							</div>
						</TableCell>
						<TableCell>
							<CarrierStatus carrier={carrier} />
						</TableCell>
						<TableCell
							className="text-right tabular-nums"
							title={`${carrier.airsideMappingCount} filed through Airside, ${carrier.activeMappingCount} active in total`}
						>
							{carrier.airsideMappingCount}
							<span className="text-muted-foreground">
								{" "}
								/ {carrier.activeMappingCount}
							</span>
						</TableCell>
						<TableCell className="text-right">
							<RoutedCostCell
								carrier={carrier}
								bucket={bucket}
								window={window}
							/>
						</TableCell>
						<TableCell className="text-right tabular-nums">
							{formatNumber(carrier.requestCount)}
						</TableCell>
						<TableCell className="text-right">
							<ErrorRateCell carrier={carrier} />
						</TableCell>
						<TableCell className="text-right">
							{formatPercent(carrier.discountPercent)}
						</TableCell>
						{showMargin && (
							<>
								<TableCell className="text-right">
									{formatPercent(carrier.marginPercent)}
								</TableCell>
								<TableCell className="text-right">
									<Badge
										variant={
											carrier.routingAdjustment < 0
												? "secondary"
												: carrier.routingAdjustment > 0
													? "destructive"
													: "outline"
										}
									>
										{carrier.routingAdjustment > 0 ? "+" : ""}
										{formatPercent(carrier.routingAdjustment)}
									</Badge>
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatUsd(carrier.marginAmount30d)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatUsd(carrier.marginAmountTotal)}
								</TableCell>
							</>
						)}
						<TableCell className="text-muted-foreground text-right text-xs">
							{new Date(carrier.updatedAt).toLocaleDateString()}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

export function AirsideCarriersClient() {
	const $api = useApi();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const window = parseCarrierWindow(searchParams.get("window"));
	const query = $api.useQuery(
		"get",
		"/admin/airside/routing-settings",
		{ params: { query: { window } } },
		{ placeholderData: keepPreviousData },
	);
	// Margin fields are stripped from staff responses.
	const showMargin = canWrite(useAdminRole());
	const [sort, setSort] = useState<{ key: SortKey; order: SortOrder }>({
		key: "routedCost",
		order: "desc",
	});

	const handleSort = (key: SortKey) => {
		setSort((current) =>
			current.key === key
				? { key, order: current.order === "asc" ? "desc" : "asc" }
				: { key, order: key === "name" ? "asc" : "desc" },
		);
	};

	const setWindow = (value: CarrierWindow) => {
		const params = new URLSearchParams(searchParams.toString());
		params.set("window", value);
		router.replace(`${pathname}?${params.toString()}`, { scroll: false });
	};

	const { active, inactive } = useMemo(() => {
		const sorted = sortCarriers(
			query.data?.providers ?? [],
			sort.key,
			sort.order,
		);
		return {
			active: sorted.filter((carrier) => carrier.status === "active"),
			inactive: sorted.filter((carrier) => carrier.status === "inactive"),
		};
	}, [query.data, sort]);
	const bucket = query.data?.bucket ?? "day";
	const tableProps = {
		bucket,
		window,
		showMargin,
		sort,
		onSort: handleSort,
	};

	return (
		<div className="space-y-6 p-6">
			<div>
				<h1 className="text-2xl font-bold">Airside carriers</h1>
				<p className="text-muted-foreground text-sm">
					Every carrier's traffic, health, and routing settings
					{showMargin
						? ", and the gateway margin accrued on their traffic"
						: ""}
					. Open a carrier to review its mappings and verify them against the
					upstream.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Carriers</CardTitle>
					<CardDescription>
						Routed cost, requests, and error rate cover the{" "}
						{carrierWindowOption(window).label} from the hourly mapping rollups,
						one bar per {carrierWindowOption(window).bucket}. Mappings are filed
						through Airside / active in total.
						{showMargin
							? " A negative routing adjustment means the carrier's traffic is boosted. Margin figures come from the daily global rollups (credits only)."
							: ""}
					</CardDescription>
					<CardAction className="flex items-center gap-2">
						{query.isFetching && !query.isLoading ? (
							<Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
						) : null}
						<div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-1">
							{CARRIER_WINDOW_OPTIONS.map((option) => (
								<Button
									key={option.value}
									variant={window === option.value ? "default" : "ghost"}
									size="sm"
									className="h-7 px-3 text-xs"
									onClick={() => setWindow(option.value)}
								>
									{option.value}
								</Button>
							))}
						</div>
					</CardAction>
				</CardHeader>
				<CardContent className="space-y-4">
					{query.isLoading ? (
						<div className="flex justify-center py-8">
							<Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
						</div>
					) : active.length === 0 && inactive.length === 0 ? (
						<p className="text-muted-foreground py-4 text-center text-sm">
							No carriers have routing settings yet.
						</p>
					) : (
						<>
							{active.length > 0 ? (
								<CarrierTable carriers={active} {...tableProps} />
							) : (
								<p className="text-muted-foreground py-4 text-center text-sm">
									No carrier has an active mapping.
								</p>
							)}
							{inactive.length > 0 ? (
								<Collapsible>
									<CollapsibleTrigger asChild>
										<Button
											variant="ghost"
											size="sm"
											className="group text-muted-foreground"
										>
											<ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
											Inactive carriers ({inactive.length})
										</Button>
									</CollapsibleTrigger>
									<CollapsibleContent className="pt-2">
										<CarrierTable carriers={inactive} {...tableProps} />
									</CollapsibleContent>
								</Collapsible>
							) : null}
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
