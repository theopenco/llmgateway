"use client";

import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

/**
 * Token counts split by billed token type, plus the cost each type accounts
 * for. Every admin stats payload carries this shape, so a single set of
 * renderers covers the history chart, the list tables and the detail pages.
 */
export interface TokenBreakdownData {
	inputTokens: number;
	cachedTokens: number;
	outputTokens: number;
	inputCost: number;
	cachedInputCost: number;
	outputCost: number;
}

type TokenKind = "input" | "cached" | "output";

const SEGMENTS: {
	kind: TokenKind;
	label: string;
	shortLabel: string;
	tokensKey: keyof TokenBreakdownData;
	costKey: keyof TokenBreakdownData;
	color: string;
}[] = [
	{
		kind: "input",
		label: "Input",
		shortLabel: "In",
		tokensKey: "inputTokens",
		costKey: "inputCost",
		color: "hsl(221 83% 53%)",
	},
	{
		kind: "cached",
		label: "Cached",
		shortLabel: "Cached",
		tokensKey: "cachedTokens",
		costKey: "cachedInputCost",
		color: "hsl(142 71% 45%)",
	},
	{
		kind: "output",
		label: "Output",
		shortLabel: "Out",
		tokensKey: "outputTokens",
		costKey: "outputCost",
		color: "hsl(32 95% 44%)",
	},
];

export function formatCompactTokens(value: number): string {
	if (!Number.isFinite(value)) {
		return "0";
	}
	if (value >= 1_000_000_000) {
		return `${(value / 1_000_000_000).toFixed(1)}B`;
	}
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(1)}k`;
	}
	return Math.round(value).toLocaleString("en-US");
}

function formatCost(value: number): string {
	if (value === 0) {
		return "$0.00";
	}
	if (Math.abs(value) < 0.01) {
		return `$${value.toFixed(6)}`;
	}
	return `$${value.toFixed(4)}`;
}

function formatExactTokens(value: number): string {
	return Math.round(value).toLocaleString("en-US");
}

// Effective blended rate for the segment, which is the number that actually
// explains a surprising cost — a catalogue price alone cannot, because a row
// aggregates many mappings (and price changes) over the window.
function formatRate(tokens: number, cost: number): string | null {
	if (tokens <= 0 || cost <= 0) {
		return null;
	}
	return `$${((cost / tokens) * 1_000_000).toFixed(2)}/M`;
}

function SegmentHoverCard({
	label,
	tokens,
	cost,
	totalTokens,
	children,
}: {
	label: string;
	tokens: number;
	cost: number;
	totalTokens: number;
	children: React.ReactNode;
}) {
	const rate = formatRate(tokens, cost);
	const share = totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;

	return (
		<HoverCard openDelay={120} closeDelay={60}>
			<HoverCardTrigger asChild>{children}</HoverCardTrigger>
			<HoverCardContent className="w-56 p-3 text-xs">
				<p className="font-medium text-foreground">{label} tokens</p>
				<dl className="mt-2 space-y-1">
					<div className="flex items-center justify-between gap-4">
						<dt className="text-muted-foreground">Tokens</dt>
						<dd className="tabular-nums">{formatExactTokens(tokens)}</dd>
					</div>
					<div className="flex items-center justify-between gap-4">
						<dt className="text-muted-foreground">Cost</dt>
						<dd className="tabular-nums font-medium">{formatCost(cost)}</dd>
					</div>
					{rate && (
						<div className="flex items-center justify-between gap-4">
							<dt className="text-muted-foreground">Blended rate</dt>
							<dd className="tabular-nums">{rate}</dd>
						</div>
					)}
					<div className="flex items-center justify-between gap-4">
						<dt className="text-muted-foreground">Share</dt>
						<dd className="tabular-nums">{share.toFixed(1)}%</dd>
					</div>
				</dl>
			</HoverCardContent>
		</HoverCard>
	);
}

/**
 * Inline `In 15.1M · Cached 3.0M · Out 2.2M` breakdown where hovering any
 * segment reveals the cost that segment accounts for.
 */
export function TokenBreakdown({
	breakdown,
	short = false,
	className,
}: {
	breakdown: TokenBreakdownData;
	short?: boolean;
	className?: string;
}) {
	const totalTokens =
		breakdown.inputTokens + breakdown.cachedTokens + breakdown.outputTokens;

	return (
		<span
			className={cn(
				"inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground",
				className,
			)}
		>
			{SEGMENTS.map((segment, i) => {
				const tokens = breakdown[segment.tokensKey];
				const cost = breakdown[segment.costKey];
				return (
					<span key={segment.kind} className="inline-flex items-center gap-2">
						{i > 0 && <span aria-hidden="true">·</span>}
						<SegmentHoverCard
							label={segment.label}
							tokens={tokens}
							cost={cost}
							totalTokens={totalTokens}
						>
							<button
								type="button"
								className="inline-flex items-center gap-1 rounded underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={(e) => e.stopPropagation()}
							>
								<span
									aria-hidden="true"
									className="h-1.5 w-1.5 rounded-full"
									style={{ backgroundColor: segment.color }}
								/>
								{short ? segment.shortLabel : segment.label}{" "}
								<strong className="font-medium tabular-nums text-foreground">
									{formatCompactTokens(tokens)}
								</strong>
							</button>
						</SegmentHoverCard>
					</span>
				);
			})}
		</span>
	);
}

/**
 * Stacked variant for table cells, where the three segments need to line up
 * across rows rather than flow inline.
 */
export function TokenBreakdownCell({
	breakdown,
}: {
	breakdown: TokenBreakdownData;
}) {
	const totalTokens =
		breakdown.inputTokens + breakdown.cachedTokens + breakdown.outputTokens;

	if (totalTokens === 0) {
		return <span className="text-muted-foreground">{"—"}</span>;
	}

	return (
		<div className="flex flex-col gap-0.5 text-xs">
			{SEGMENTS.map((segment) => (
				<SegmentHoverCard
					key={segment.kind}
					label={segment.label}
					tokens={breakdown[segment.tokensKey]}
					cost={breakdown[segment.costKey]}
					totalTokens={totalTokens}
				>
					<button
						type="button"
						className="flex items-center justify-between gap-2 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={(e) => e.stopPropagation()}
					>
						<span className="inline-flex items-center gap-1">
							<span
								aria-hidden="true"
								className="h-1.5 w-1.5 rounded-full"
								style={{ backgroundColor: segment.color }}
							/>
							{segment.shortLabel}
						</span>
						<span className="tabular-nums text-foreground">
							{formatCompactTokens(breakdown[segment.tokensKey])}
						</span>
					</button>
				</SegmentHoverCard>
			))}
		</div>
	);
}

/**
 * Card-sized variant for the detail pages, matching the surrounding StatCard
 * grid: one card per token type showing the count with the cost on hover.
 */
export function TokenBreakdownCards({
	breakdown,
	loading,
}: {
	breakdown: TokenBreakdownData;
	loading?: boolean;
}) {
	const totalTokens =
		breakdown.inputTokens + breakdown.cachedTokens + breakdown.outputTokens;

	return (
		<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<div className="rounded-xl border border-border/60 p-4 shadow-sm">
				<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Total Tokens
				</p>
				<p
					className={cn(
						"mt-1 text-2xl font-semibold tabular-nums",
						loading && "opacity-50",
					)}
				>
					{formatCompactTokens(totalTokens)}
				</p>
			</div>
			{SEGMENTS.map((segment) => (
				<SegmentHoverCard
					key={segment.kind}
					label={segment.label}
					tokens={breakdown[segment.tokensKey]}
					cost={breakdown[segment.costKey]}
					totalTokens={totalTokens}
				>
					<button
						type="button"
						className="rounded-xl border border-border/60 p-4 text-left shadow-sm transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							<span
								aria-hidden="true"
								className="h-1.5 w-1.5 rounded-full"
								style={{ backgroundColor: segment.color }}
							/>
							{segment.label} Tokens
						</p>
						<p
							className={cn(
								"mt-1 text-2xl font-semibold tabular-nums",
								loading && "opacity-50",
							)}
						>
							{formatCompactTokens(breakdown[segment.tokensKey])}
						</p>
						<p className="mt-1 text-xs text-muted-foreground tabular-nums">
							{formatCost(breakdown[segment.costKey])}
						</p>
					</button>
				</SegmentHoverCard>
			))}
		</section>
	);
}
