"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { formatCompactNumber } from "@llmgateway/shared/number-format";

import type { GlobalStatsCsvBreakdownItem } from "@/lib/global-stats-csv";

type Metric = Exclude<keyof GlobalStatsCsvBreakdownItem, "key" | "label">;

interface Column {
	metric: Metric;
	label: string;
	kind: "count" | "tokens" | "cost";
	// Hidden unless some row in the current view has a non-zero value.
	optional?: boolean;
}

const COLUMNS: Column[] = [
	{ metric: "requestCount", label: "Requests", kind: "count" },
	{ metric: "errorCount", label: "Errors", kind: "count", optional: true },
	{ metric: "inputTokens", label: "Input tok", kind: "tokens" },
	{
		metric: "cachedTokens",
		label: "Cached tok",
		kind: "tokens",
		optional: true,
	},
	{
		metric: "cacheWriteTokens",
		label: "Cache write tok",
		kind: "tokens",
		optional: true,
	},
	{ metric: "outputTokens", label: "Output tok", kind: "tokens" },
	{
		metric: "reasoningTokens",
		label: "Reasoning tok",
		kind: "tokens",
		optional: true,
	},
	{ metric: "totalTokens", label: "Total tok", kind: "tokens" },
	{ metric: "cost", label: "Cost", kind: "cost" },
	{ metric: "inputCost", label: "Input $", kind: "cost" },
	{
		metric: "cachedInputCost",
		label: "Cached input $",
		kind: "cost",
		optional: true,
	},
	{
		metric: "cacheWriteInputCost",
		label: "Cache write $",
		kind: "cost",
		optional: true,
	},
	{ metric: "outputCost", label: "Output $", kind: "cost" },
	{ metric: "requestCost", label: "Request $", kind: "cost", optional: true },
	{
		metric: "imageInputCost",
		label: "Image input $",
		kind: "cost",
		optional: true,
	},
	{
		metric: "imageOutputCost",
		label: "Image output $",
		kind: "cost",
		optional: true,
	},
	{
		metric: "audioInputCost",
		label: "Audio input $",
		kind: "cost",
		optional: true,
	},
	{
		metric: "audioOutputCost",
		label: "Audio output $",
		kind: "cost",
		optional: true,
	},
	{
		metric: "videoOutputCost",
		label: "Video output $",
		kind: "cost",
		optional: true,
	},
];

const PAGE_SIZE = 25;

const numberFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

const MIN_VISIBLE_COST = 0.0001;

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

function formatCell(column: Column, value: number): string {
	switch (column.kind) {
		case "cost":
			// Keep tiny non-zero costs distinguishable from zero.
			return value > 0 && value < MIN_VISIBLE_COST
				? `<${currencyFormatter.format(MIN_VISIBLE_COST)}`
				: currencyFormatter.format(value);
		case "tokens":
			return formatCompactNumber(value);
		case "count":
		default:
			return numberFormatter.format(value);
	}
}

/**
 * Every rolled-up token and cost column per breakdown row, in the order the
 * caller ranked them, with a totals row.
 */
export function GlobalStatsBreakdownDetails({
	rows,
	totals,
	dimensionLabel,
	isLoading,
}: {
	rows: readonly GlobalStatsCsvBreakdownItem[];
	totals: Omit<GlobalStatsCsvBreakdownItem, "key" | "label"> | undefined;
	dimensionLabel: string;
	isLoading: boolean;
}) {
	const [page, setPage] = useState(1);
	const columns = useMemo(
		() =>
			COLUMNS.filter(
				(column) =>
					!column.optional || rows.some((row) => row[column.metric] !== 0),
			),
		[rows],
	);

	const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
	const currentPage = Math.min(page, totalPages);
	const start = (currentPage - 1) * PAGE_SIZE;
	const pagedRows = rows.slice(start, start + PAGE_SIZE);

	return (
		<div className="flex flex-col">
			<div className="overflow-x-auto rounded-md border border-border/60">
				<table className="w-full text-sm">
					<thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
						<tr>
							<th className="sticky left-0 bg-muted px-3 py-2 text-left">
								{dimensionLabel}
							</th>
							{columns.map((column) => (
								<th
									key={column.metric}
									className="whitespace-nowrap px-3 py-2 text-right"
								>
									{column.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.length === 0 ? (
							<tr>
								<td
									colSpan={columns.length + 1}
									className="px-3 py-6 text-center text-muted-foreground"
								>
									{isLoading ? "Loading…" : "No data."}
								</td>
							</tr>
						) : (
							pagedRows.map((row) => (
								<tr key={row.key} className="border-t border-border/40">
									<td className="sticky left-0 max-w-72 truncate bg-card px-3 py-2 font-mono text-xs">
										{row.label}
									</td>
									{columns.map((column) => (
										<td
											key={column.metric}
											className="whitespace-nowrap px-3 py-2 text-right tabular-nums"
											title={
												column.kind === "tokens"
													? numberFormatter.format(row[column.metric])
													: undefined
											}
										>
											{formatCell(column, row[column.metric])}
										</td>
									))}
								</tr>
							))
						)}
					</tbody>
					{totals && rows.length > 0 ? (
						<tfoot className="border-t border-border/60 bg-muted/20 font-medium">
							<tr>
								<td className="sticky left-0 bg-muted px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
									Total
								</td>
								{columns.map((column) => (
									<td
										key={column.metric}
										className="whitespace-nowrap px-3 py-2 text-right tabular-nums"
										title={
											column.kind === "tokens"
												? numberFormatter.format(totals[column.metric])
												: undefined
										}
									>
										{formatCell(column, totals[column.metric])}
									</td>
								))}
							</tr>
						</tfoot>
					) : null}
				</table>
			</div>
			{rows.length > PAGE_SIZE ? (
				<div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
					<span className="tabular-nums">
						{start + 1}–{start + pagedRows.length} of {rows.length}
					</span>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							className="h-7 px-3"
							disabled={currentPage <= 1}
							onClick={() => setPage(Math.max(1, currentPage - 1))}
						>
							Previous
						</Button>
						<span className="tabular-nums">
							Page {currentPage} / {totalPages}
						</span>
						<Button
							variant="outline"
							size="sm"
							className="h-7 px-3"
							disabled={currentPage >= totalPages}
							onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
						>
							Next
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
