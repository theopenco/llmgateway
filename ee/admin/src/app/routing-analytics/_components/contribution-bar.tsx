import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

import { formatContribution } from "./format";

import type { ScoreBreakdown } from "./types";

type ContributionKey = keyof Pick<
	ScoreBreakdown,
	| "priceContribution"
	| "uptimeContribution"
	| "throughputContribution"
	| "latencyContribution"
	| "cacheContribution"
	| "priorityPenalty"
	| "uptimePenalty"
>;

/** Score parts in stacking order, with fixed hues shared by every row. */
export const CONTRIBUTION_SEGMENTS: {
	key: ContributionKey;
	label: string;
	color: string;
}[] = [
	{ key: "priceContribution", label: "Price", color: "hsl(221 83% 53%)" },
	{ key: "uptimeContribution", label: "Uptime", color: "hsl(142 71% 45%)" },
	{
		key: "throughputContribution",
		label: "Throughput",
		color: "hsl(189 94% 43%)",
	},
	{ key: "latencyContribution", label: "Latency", color: "hsl(280 65% 60%)" },
	{ key: "cacheContribution", label: "Cache", color: "hsl(48 96% 53%)" },
	{
		key: "priorityPenalty",
		label: "Priority penalty",
		color: "hsl(32 95% 44%)",
	},
	{ key: "uptimePenalty", label: "Uptime penalty", color: "hsl(0 72% 51%)" },
];

export function ContributionLegend() {
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-1.5">
			{CONTRIBUTION_SEGMENTS.map((segment) => (
				<div key={segment.key} className="flex items-center gap-1.5 text-xs">
					<span
						className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
						style={{ backgroundColor: segment.color }}
					/>
					{segment.label}
				</div>
			))}
		</div>
	);
}

/** Sum of the parts drawn as segments; the shared bar scale is its max. */
export function positiveContributionTotal(breakdown: ScoreBreakdown): number {
	return CONTRIBUTION_SEGMENTS.reduce(
		(sum, segment) => sum + Math.max(breakdown[segment.key], 0),
		0,
	);
}

/**
 * The score's positive parts stacked on a scale shared across rows. A
 * priority bonus (negative penalty) has no segment, so bar length is the
 * score only without one; the row and tooltip state the bonus.
 */
export function ContributionBar({
	breakdown,
	score,
	scale,
}: {
	breakdown: ScoreBreakdown;
	score: number;
	scale: number;
}) {
	const visible = CONTRIBUTION_SEGMENTS.filter(
		(segment) => breakdown[segment.key] > 0,
	);
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className="flex h-3 w-full cursor-default overflow-hidden rounded-full bg-muted">
					{scale > 0
						? visible.map((segment) => (
								<div
									key={segment.key}
									style={{
										width: `${(breakdown[segment.key] / scale) * 100}%`,
										backgroundColor: segment.color,
									}}
								/>
							))
						: null}
				</div>
			</TooltipTrigger>
			<TooltipContent className="w-56">
				<div className="space-y-0.5 font-mono">
					{CONTRIBUTION_SEGMENTS.map((segment) => (
						<div key={segment.key} className="flex justify-between gap-4">
							<span className="font-sans">{segment.label}</span>
							<span>{formatContribution(breakdown[segment.key])}</span>
						</div>
					))}
					<div className="flex justify-between gap-4 border-t border-background/30 pt-0.5 font-semibold">
						<span className="font-sans">Score</span>
						<span>{score.toFixed(3)}</span>
					</div>
				</div>
			</TooltipContent>
		</Tooltip>
	);
}
