"use client";

import {
	AlertCircle,
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
} from "lucide-react";
import Link from "next/link";

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
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { paths } from "@/lib/api/v1";

export type DevpassListQuery = NonNullable<
	paths["/admin/devpass"]["get"]["parameters"]["query"]
>;

type SortBy = NonNullable<DevpassListQuery["sortBy"]>;
type SortOrder = NonNullable<DevpassListQuery["sortOrder"]>;

const COLUMN_COUNT = 16;

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
		default:
			return "outline";
	}
}

function getStatusBadgeVariant(
	status: string,
): "default" | "secondary" | "outline" | "destructive" {
	switch (status) {
		case "active":
		case "renewal processing":
			return "secondary";
		case "expired":
		case "past due":
			return "destructive";
		default:
			return "outline";
	}
}

function formatStatus(
	status: string,
	hasPaymentIssue: boolean,
	cancelled: boolean,
) {
	if (hasPaymentIssue) {
		return "past due";
	}
	if (status === "expired" && !cancelled) {
		return "renewal processing";
	}
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

	return (
		<Link
			href={`/devpass?${baseParams.toString()}`}
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

// Both the filter card's match counter and the table below it render from the
// same request — identical query keys, so TanStack Query dedupes them.
//
// staleTime 0 (the provider default is 5 minutes): an admin who cancels or
// refunds on a detail page and navigates back must see the new row state. The
// dialogs only call router.refresh(), which does not touch this cache.
function useDevpassSubscribers(query: DevpassListQuery) {
	const $api = useApi();
	return $api.useQuery(
		"get",
		"/admin/devpass",
		{ params: { query } },
		{ staleTime: 0 },
	);
}

function pageHref(queryString: string, targetPage: number) {
	const sp = new URLSearchParams(queryString);
	sp.set("page", String(targetPage));
	return `/devpass?${sp.toString()}`;
}

// `disabled` on an `asChild` Button lands on the anchor, where it does nothing:
// the link stays keyboard-reachable and reads as enabled. Render a real button
// instead when the target page is out of range.
function PageLink({
	href,
	disabled,
	label,
	icon,
	iconAfter,
}: {
	href: string;
	disabled: boolean;
	label: string;
	icon: React.ReactNode;
	iconAfter?: boolean;
}) {
	const content = iconAfter ? (
		<>
			{label}
			{icon}
		</>
	) : (
		<>
			{icon}
			{label}
		</>
	);

	if (disabled) {
		return (
			<Button variant="outline" size="sm" disabled>
				{content}
			</Button>
		);
	}

	return (
		<Button variant="outline" size="sm" asChild>
			<Link href={href}>{content}</Link>
		</Button>
	);
}

export function DevpassResultCount({ query }: { query: DevpassListQuery }) {
	const { data, error } = useDevpassSubscribers(query);

	if (error) {
		// The table below states the failure; a second copy here adds nothing.
		return null;
	}

	if (!data) {
		return <div className="h-4 w-56 animate-pulse rounded bg-muted/40" />;
	}

	return (
		<p className="text-xs text-muted-foreground">
			{data.total} subscriber{data.total === 1 ? "" : "s"} match current filters
		</p>
	);
}

export function DevpassSubscribersTable({
	query,
	queryString,
	page,
	limit,
}: {
	query: DevpassListQuery;
	queryString: string;
	page: number;
	limit: number;
}) {
	const { data, error } = useDevpassSubscribers(query);

	const sortBy = query.sortBy ?? "subscribedSince";
	const sortOrder = query.sortOrder ?? "desc";
	const offset = (page - 1) * limit;
	const totalPages = data ? Math.ceil(data.total / limit) : 0;

	return (
		<>
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
							<TableHead>
								<SortableHeader
									label="PAYG"
									sortKey="paygBalance"
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
						{error ? (
							<TableRow>
								<TableCell
									colSpan={COLUMN_COUNT}
									className="h-24 text-center text-muted-foreground"
								>
									Failed to load subscribers.{" "}
									<Link href="/login" className="underline">
										Sign in
									</Link>{" "}
									again if your session expired.
								</TableCell>
							</TableRow>
						) : !data ? (
							Array.from({ length: 10 }, (_, i) => (
								<TableRow key={i}>
									<TableCell colSpan={COLUMN_COUNT}>
										<div className="h-6 animate-pulse rounded bg-muted/40" />
									</TableCell>
								</TableRow>
							))
						) : data.subscribers.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={COLUMN_COUNT}
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
										{sub.ownerUsername && (
											<p className="text-xs text-muted-foreground">
												@{sub.ownerUsername}
											</p>
										)}
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
										<Badge
											variant={getStatusBadgeVariant(
												formatStatus(
													sub.status,
													sub.hasPaymentIssue,
													sub.cancelled,
												),
											)}
										>
											{formatStatus(
												sub.status,
												sub.hasPaymentIssue,
												sub.cancelled,
											)}
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
										{sub.hasPaymentIssue ? (
											<>
												<span className="font-medium text-destructive">
													Payment failed
												</span>
												{sub.expiresAt && (
													<p>Due {formatDate(sub.expiresAt)}</p>
												)}
											</>
										) : sub.expiresAt &&
										  new Date(sub.expiresAt) <= new Date() ? (
											<>
												<span className="font-medium text-amber-600 dark:text-amber-400">
													Processing
												</span>
												<p>Due {formatDate(sub.expiresAt)}</p>
											</>
										) : sub.expiresAt ? (
											formatDate(sub.expiresAt)
										) : (
											"—"
										)}
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
										{sub.cycleOverflowCost > 0 && (
											<p
												className="mt-0.5 text-xs font-normal text-muted-foreground"
												title="Cycle cost paid from the org's own PAYG credits — excluded from plan margin"
											>
												+
												{currencyFormatterPrecise.format(sub.cycleOverflowCost)}{" "}
												overflow
											</p>
										)}
									</TableCell>
									<TableCell className="tabular-nums text-xs">
										{sub.paygEnabled ? (
											<>
												<span className="font-medium">
													{currencyFormatter.format(
														parseFloat(sub.paygBalance),
													)}
												</span>
												{sub.autoTopUpEnabled && (
													<Badge variant="outline" className="ml-1.5">
														auto
													</Badge>
												)}
												{sub.allTimeTopUps > 0 && (
													<p className="mt-0.5 text-muted-foreground">
														{currencyFormatter.format(sub.allTimeTopUps)} topped
														up
													</p>
												)}
											</>
										) : (
											<span className="text-muted-foreground">—</span>
										)}
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

			{data && totalPages > 1 && (
				<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm text-muted-foreground">
						Showing {offset + 1} to {Math.min(offset + limit, data.total)} of{" "}
						{data.total}
					</p>
					<div className="flex items-center gap-2">
						<PageLink
							href={pageHref(queryString, page - 1)}
							disabled={page <= 1}
							label="Previous"
							icon={<ChevronLeft className="h-4 w-4" />}
						/>
						<span className="text-sm text-muted-foreground">
							Page {page} of {totalPages}
						</span>
						<PageLink
							href={pageHref(queryString, page + 1)}
							disabled={page >= totalPages}
							label="Next"
							icon={<ChevronRight className="h-4 w-4" />}
							iconAfter
						/>
					</div>
				</div>
			)}
		</>
	);
}
