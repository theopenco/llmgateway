import { cn } from "@/lib/utils";

import { formatPercent, numberFormatter } from "./format";

export interface ProportionSegment {
	key: string;
	label: string;
	value: number;
	color: string;
}

/**
 * Single-row stacked proportion bar, for splits where the shares matter more
 * than absolute counts. `compact` drops the legend and thins the bar for use
 * inside a table row; segment titles still carry the numbers.
 */
export function ProportionBar({
	segments,
	total,
	compact = false,
	emptyLabel = "No routed requests in this window.",
}: {
	segments: ProportionSegment[];
	total: number;
	compact?: boolean;
	emptyLabel?: string;
}) {
	if (total <= 0) {
		return (
			<p
				className={cn(
					"text-muted-foreground",
					compact ? "text-[11px]" : "text-sm",
				)}
			>
				{emptyLabel}
			</p>
		);
	}
	const visible = segments.filter((segment) => segment.value > 0);
	const bar = (
		<div
			className={cn(
				"flex w-full overflow-hidden rounded-full bg-muted",
				compact ? "h-2" : "h-3",
			)}
		>
			{visible.map((segment) => (
				<div
					key={segment.key}
					style={{
						width: `${(segment.value / total) * 100}%`,
						backgroundColor: segment.color,
					}}
					title={`${segment.label}: ${numberFormatter.format(segment.value)} (${formatPercent(segment.value, total)})`}
				/>
			))}
		</div>
	);
	if (compact) {
		return bar;
	}
	return (
		<div className="space-y-3">
			{bar}
			<div className="flex flex-wrap gap-x-4 gap-y-1.5">
				{visible.map((segment) => (
					<div key={segment.key} className="flex items-center gap-1.5 text-xs">
						<span
							className="h-2.5 w-2.5 shrink-0 rounded-full"
							style={{ backgroundColor: segment.color }}
						/>
						<span>{segment.label}</span>
						<span className="font-mono text-muted-foreground">
							{formatPercent(segment.value, total)}
						</span>
						<span className="font-mono text-muted-foreground">
							({numberFormatter.format(segment.value)})
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
