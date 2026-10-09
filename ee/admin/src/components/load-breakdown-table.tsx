"use client";

import { keepPreviousData } from "@tanstack/react-query";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/fetch-client";
import { formatDurationMs } from "@/lib/format-duration";
import { formatErrorRate } from "@/lib/format-error-rate";
import { formatRps, formatShare } from "@/lib/format-rps";
import { cn } from "@/lib/utils";

import { formatNumber } from "@llmgateway/shared/number-format";

import type { paths } from "@/lib/api/v1";

type BreakdownQuery = NonNullable<
	paths["/admin/load/breakdown"]["get"]["parameters"]["query"]
>;
type SortBy = NonNullable<BreakdownQuery["sortBy"]>;
type SortOrder = "asc" | "desc";

const PAGE_SIZE = 25;

const COLUMNS: {
	key: SortBy;
	label: string;
	title?: string;
}[] = [
	{ key: "requestCount", label: "Requests" },
	{ key: "avgRps", label: "Avg req/s" },
	{ key: "peakRps", label: "Peak req/s" },
	{ key: "share", label: "Share" },
	{
		key: "errorRate",
		label: "Error rate",
		title: "Gateway and upstream errors over non-client requests",
	},
	{
		key: "clientErrorRate",
		label: "Client errors",
		title: "Requests rejected as the caller's own error",
	},
	{ key: "avgDurationMs", label: "Avg duration" },
	{ key: "avgTimeToFirstTokenMs", label: "Avg TTFT" },
];

const SORT_KEYS: SortBy[] = [
	"label",
	"errorCount",
	...COLUMNS.map((c) => c.key),
];

function SortableHead({
	label,
	title,
	sortKey,
	sortBy,
	sortOrder,
	onSort,
	className,
}: {
	label: string;
	title?: string;
	sortKey: SortBy;
	sortBy: SortBy;
	sortOrder: SortOrder;
	onSort: (key: SortBy) => void;
	className?: string;
}) {
	const active = sortBy === sortKey;
	return (
		<TableHead
			className={className}
			title={title}
			aria-sort={
				active ? (sortOrder === "asc" ? "ascending" : "descending") : undefined
			}
		>
			<button
				type="button"
				onClick={() => onSort(sortKey)}
				className={cn(
					"inline-flex items-center gap-1 transition-colors hover:text-foreground",
					active ? "text-foreground" : "text-muted-foreground",
				)}
			>
				{label}
				{active ? (
					sortOrder === "asc" ? (
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

/**
 * Every key with traffic, sorted and paginated server-side. Sort and page live
 * in the URL so a view can be shared.
 */
export function LoadBreakdownTable({
	query,
	groupLabel,
	linkOrganizations,
	defaultSortBy,
	refetchInterval,
}: {
	query: Omit<BreakdownQuery, "sortBy" | "sortOrder" | "page" | "pageSize">;
	groupLabel: string;
	linkOrganizations: boolean;
	defaultSortBy: SortBy;
	refetchInterval: number | false;
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const $api = useApi();

	const sortParam = searchParams.get("sortBy");
	const sortBy = SORT_KEYS.includes(sortParam as SortBy)
		? (sortParam as SortBy)
		: defaultSortBy;
	const sortOrder: SortOrder =
		searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
	const requestedPage = Math.max(1, Number(searchParams.get("page")) || 1);

	const setParams = useCallback(
		(updates: Record<string, string | null>) => {
			const params = new URLSearchParams(searchParams.toString());
			for (const [key, value] of Object.entries(updates)) {
				if (value === null) {
					params.delete(key);
				} else {
					params.set(key, value);
				}
			}
			const next = params.toString();
			router.replace(next ? `${pathname}?${next}` : pathname, {
				scroll: false,
			});
		},
		[searchParams, router, pathname],
	);

	const onSort = (key: SortBy) => {
		const nextOrder: SortOrder =
			sortBy === key
				? sortOrder === "desc"
					? "asc"
					: "desc"
				: key === "label"
					? "asc"
					: "desc";
		setParams({ sortBy: key, sortOrder: nextOrder, page: null });
	};

	const { data, isError } = $api.useQuery(
		"get",
		"/admin/load/breakdown",
		{
			params: {
				query: {
					...query,
					sortBy,
					sortOrder,
					page: requestedPage,
					pageSize: PAGE_SIZE,
				},
			},
		},
		{ refetchInterval, placeholderData: keepPreviousData },
	);

	const rows = data?.rows ?? [];
	const totalKeys = data?.totalKeys ?? 0;
	// The server clamps a page past the end, e.g. after the grouping changes.
	const page = data?.page ?? requestedPage;
	const totalPages = Math.max(1, Math.ceil(totalKeys / PAGE_SIZE));
	const offset = (page - 1) * PAGE_SIZE;
	const groupNoun = groupLabel.toLowerCase();

	const head = (column: (typeof COLUMNS)[number]) => (
		<SortableHead
			key={column.key}
			label={column.label}
			title={column.title}
			sortKey={column.key}
			sortBy={sortBy}
			sortOrder={sortOrder}
			onSort={onSort}
			className="text-right"
		/>
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Breakdown</CardTitle>
				<CardDescription>
					{isError
						? "Failed to load the breakdown."
						: data
							? `${formatNumber(totalKeys)} ${groupNoun}s with traffic`
							: "Loading…"}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<Table>
					<TableHeader>
						<TableRow>
							<SortableHead
								label={groupLabel}
								sortKey="label"
								sortBy={sortBy}
								sortOrder={sortOrder}
								onSort={onSort}
							/>
							{COLUMNS.map(head)}
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={COLUMNS.length + 1}
									className="py-8 text-center text-sm text-muted-foreground"
								>
									{data ? "No traffic in this window." : "Loading…"}
								</TableCell>
							</TableRow>
						) : (
							rows.map((row) => (
								<TableRow key={row.key}>
									<TableCell className="max-w-[320px] truncate font-medium">
										{linkOrganizations ? (
											<Link
												href={`/organizations/${row.key}`}
												className="hover:underline"
											>
												{row.label}
											</Link>
										) : (
											row.label
										)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatNumber(Math.round(row.requestCount))}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatRps(row.avgRps)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatRps(row.peakRps)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatShare(row.share)}
									</TableCell>
									<TableCell
										className="text-right tabular-nums"
										title={
											row.errorCount === null
												? undefined
												: `${formatNumber(row.errorCount)} errors`
										}
									>
										{formatErrorRate(row.errorRate)}
									</TableCell>
									<TableCell
										className="text-right tabular-nums text-muted-foreground"
										title={
											row.clientErrorCount === null
												? undefined
												: `${formatNumber(row.clientErrorCount)} client errors`
										}
									>
										{formatErrorRate(row.clientErrorRate)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatDurationMs(row.avgDurationMs)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatDurationMs(row.avgTimeToFirstTokenMs)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>

				{totalPages > 1 ? (
					<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
						<p className="text-sm text-muted-foreground">
							Showing {formatNumber(offset + 1)} to{" "}
							{formatNumber(Math.min(offset + PAGE_SIZE, totalKeys))} of{" "}
							{formatNumber(totalKeys)}
						</p>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={page <= 1}
								onClick={() =>
									setParams({ page: page - 1 > 1 ? String(page - 1) : null })
								}
							>
								<ChevronLeft className="h-4 w-4" />
								Previous
							</Button>
							<span className="text-sm text-muted-foreground">
								Page {page} of {totalPages}
							</span>
							<Button
								variant="outline"
								size="sm"
								disabled={page >= totalPages}
								onClick={() => setParams({ page: String(page + 1) })}
							>
								Next
								<ChevronRight className="h-4 w-4" />
							</Button>
						</div>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
