import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { ContributionBar } from "./contribution-bar";
import {
	electionKindColor,
	electionKindLabel,
	formatPercent,
	formatSelectionPrice,
} from "./format";
import { ProportionBar } from "./proportion-bar";

import type { ProviderElections, ScenarioProvider } from "./types";
import type { Verdict } from "./verdict";

function ProviderLabel({
	providerName,
	providerId,
	color,
}: {
	providerName: string;
	providerId: string;
	color: string | undefined;
}) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<span
				className="h-2.5 w-2.5 shrink-0 rounded-full"
				style={{ backgroundColor: color }}
			/>
			<span className="truncate font-medium">{providerName}</span>
			<span className="truncate font-mono text-xs text-muted-foreground">
				{providerId}
			</span>
		</div>
	);
}

/** How a provider's traffic arrived: its election paths and model share. */
function TrafficArrival({
	elections,
	totalRequests,
}: {
	elections: ProviderElections | undefined;
	totalRequests: number;
}) {
	const requestCount = elections?.requestCount ?? 0;
	const lead = elections?.byKind[0];
	return (
		<div className="space-y-1">
			<ProportionBar
				compact
				emptyLabel="No routed traffic in the window."
				total={requestCount}
				segments={(elections?.byKind ?? []).map((entry) => ({
					key: entry.kind,
					label: electionKindLabel(entry.kind),
					value: entry.requestCount,
					color: electionKindColor(entry.kind),
				}))}
			/>
			{requestCount > 0 && lead ? (
				<p className="text-[11px] text-muted-foreground">
					<span className="font-mono">
						{formatPercent(requestCount, totalRequests)}
					</span>{" "}
					of model traffic ·{" "}
					<span className="font-mono">
						{formatPercent(lead.requestCount, requestCount)}
					</span>{" "}
					{electionKindLabel(lead.kind).toLowerCase()}
				</p>
			) : null}
		</div>
	);
}

export function ProviderVerdictRow({
	rank,
	entry,
	best,
	verdict,
	scale,
	providerName,
	color,
	isImageModel,
	elections,
	totalElections,
}: {
	rank: number;
	entry: ScenarioProvider;
	best: ScenarioProvider;
	verdict: Verdict;
	scale: number;
	providerName: string;
	color: string | undefined;
	isImageModel: boolean;
	elections: ProviderElections | undefined;
	totalElections: number;
}) {
	const isWinner = entry.providerId === best.providerId;
	return (
		<div className="grid gap-x-6 gap-y-3 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,14rem)]">
			<div className="flex min-w-0 items-start gap-3">
				<span
					className={cn(
						"mt-0.5 font-mono text-sm tabular-nums",
						isWinner ? "font-semibold" : "text-muted-foreground",
					)}
				>
					#{rank}
				</span>
				<div className="min-w-0 space-y-1">
					<ProviderLabel
						providerName={providerName}
						providerId={entry.providerId}
						color={color}
					/>
					<div className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs">
						<span className="font-semibold">{entry.score.toFixed(3)}</span>
						<span className="text-muted-foreground">
							{isWinner ? "best" : `+${(entry.score - best.score).toFixed(3)}`}
						</span>
						<span className="text-muted-foreground">
							{formatSelectionPrice(entry.price, isImageModel)}
						</span>
					</div>
				</div>
			</div>
			<div className="min-w-0 space-y-2">
				<ContributionBar
					breakdown={entry.breakdown}
					score={entry.score}
					scale={scale}
				/>
				<p className="text-sm">{verdict.headline}</p>
				{verdict.notes.map((note) => (
					<p key={note} className="text-xs text-amber-700 dark:text-amber-400">
						{note}
					</p>
				))}
			</div>
			<TrafficArrival elections={elections} totalRequests={totalElections} />
		</div>
	);
}

export function ExcludedMappingRow({
	providerName,
	providerId,
	color,
	excludedReasons,
	elections,
	totalElections,
}: {
	providerName: string;
	providerId: string;
	color: string | undefined;
	excludedReasons: string[];
	elections: ProviderElections | undefined;
	totalElections: number;
}) {
	return (
		<div className="grid gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,14rem)]">
			<div className="pl-8">
				<ProviderLabel
					providerName={providerName}
					providerId={providerId}
					color={color}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-1">
				<span className="mr-1 text-xs text-muted-foreground">
					Never scored:
				</span>
				{excludedReasons.map((reason) => (
					<Badge key={reason} variant="destructive" className="text-xs">
						{reason}
					</Badge>
				))}
			</div>
			<TrafficArrival elections={elections} totalRequests={totalElections} />
		</div>
	);
}
