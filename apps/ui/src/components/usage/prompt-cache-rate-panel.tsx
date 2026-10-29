"use client";

import { differenceInCalendarDays, format } from "date-fns";
import { Lock } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { ContactSalesButton } from "@/components/contact-sales";
import { getDateRangeFromParams } from "@/components/date-range-picker";
import {
	toApiGroupBy,
	type ModelUsageGroupBy,
} from "@/components/usage/group-by";
import { Badge } from "@/lib/components/badge";
import { useApi } from "@/lib/fetch-client";

import { resolveUsageBucket } from "@llmgateway/shared/prompt-cache";
import { UsageTimeseriesChart } from "@llmgateway/shared/usage-timeseries";

import type { TimeRangeValue } from "@/components/time-range-picker";
import type {
	UsageBucket,
	UsageTimeseries,
} from "@llmgateway/shared/prompt-cache";

const TIME_RANGE_DAYS: Record<TimeRangeValue, number> = {
	"1h": 1 / 24,
	"4h": 4 / 24,
	"24h": 1,
	"7d": 7,
	"30d": 30,
};

const SAMPLE_SERIES = [
	{ key: "claude-sonnet-4-6", label: "claude-sonnet-4-6", base: 72 },
	{ key: "gpt-5-mini", label: "gpt-5-mini", base: 48 },
	{ key: "gemini-3-flash", label: "gemini-3-flash", base: 28 },
];

const zeroSplit = {
	cost: 0,
	totalTokens: 0,
	creditsCost: 0,
	apiKeysCost: 0,
	creditsRequestCount: 0,
	apiKeysRequestCount: 0,
};

/** Deterministic sample data so the preview looks like a real project. */
function buildSampleTimeseries(bucket: UsageBucket): UsageTimeseries {
	const step = bucket === "hour" ? 3_600_000 : 86_400_000;
	const end = Math.floor(Date.now() / step) * step;
	const stepsBack = Array.from({ length: 24 }, (_, i) => (23 - i) * step);
	const points = Array.from({ length: 24 }, (_, i) => {
		const entries = SAMPLE_SERIES.map((series, s) => {
			const phase = i / 2;
			const volumeWave = Math.sin(phase + s);
			const requestCount = 20 + Math.round(25 * (1 + volumeWave));
			const inputTokens = requestCount * 2400;
			const ratePhase = i / 3;
			const seriesShift = s * 2;
			const rateWave = 14 * Math.sin(ratePhase + seriesShift);
			const rate = Math.min(95, Math.max(2, series.base + rateWave + (i % 4)));
			return {
				key: series.key,
				label: series.label,
				...zeroSplit,
				requestCount,
				inputTokens,
				cachedTokens: Math.round((inputTokens * rate) / 100),
			};
		});
		const totals = entries.reduce(
			(sum, entry) => ({
				...sum,
				requestCount: sum.requestCount + entry.requestCount,
				inputTokens: sum.inputTokens + entry.inputTokens,
				cachedTokens: sum.cachedTokens + entry.cachedTokens,
			}),
			{ ...zeroSplit, requestCount: 0, inputTokens: 0, cachedTokens: 0 },
		);
		return {
			timestamp: new Date(end - stepsBack[i]).toISOString(),
			incomplete: false,
			totals,
			entries,
		};
	});
	return {
		bucket,
		series: SAMPLE_SERIES.map(({ key, label }) => ({ key, label })),
		points,
		filters: { models: [], apiKeys: [] },
	};
}

interface PromptCacheRatePanelProps {
	projectId: string;
	isEnterprise: boolean;
	groupBy: ModelUsageGroupBy;
	apiKeyId?: string;
	timeRange?: TimeRangeValue;
	timeZone: string;
}

export function PromptCacheRatePanel({
	projectId,
	isEnterprise,
	groupBy,
	apiKeyId,
	timeRange,
	timeZone,
}: PromptCacheRatePanelProps) {
	const searchParams = useSearchParams();
	const api = useApi();

	const range = useMemo(() => {
		if (timeRange) {
			return { timeRange, days: TIME_RANGE_DAYS[timeRange] };
		}
		const { from, to } = getDateRangeFromParams(searchParams, timeZone);
		return {
			from: format(from, "yyyy-MM-dd"),
			to: format(to, "yyyy-MM-dd"),
			days: differenceInCalendarDays(to, from) + 1,
		};
	}, [timeRange, searchParams, timeZone]);
	const bucket = resolveUsageBucket("auto", "cacheRate", range.days);

	const query = api.useQuery(
		"get",
		"/activity/prompt-cache",
		{
			params: {
				query: {
					projectId,
					...(range.timeRange
						? { timeRange: range.timeRange }
						: { from: range.from, to: range.to }),
					groupBy: toApiGroupBy(groupBy),
					modelView: groupBy === "mapping" ? "mapping" : "canonical",
					bucket,
					timezone: timeZone,
					...(apiKeyId ? { apiKeyId } : {}),
				},
			},
		},
		{ enabled: isEnterprise },
	);

	const sample = useMemo(() => buildSampleTimeseries(bucket), [bucket]);

	if (!isEnterprise) {
		return (
			<div className="relative">
				<div
					aria-hidden
					className="pointer-events-none select-none opacity-40 blur-[2px]"
				>
					<UsageTimeseriesChart
						data={sample}
						metric="cacheRate"
						bucket={bucket}
						timeZone={timeZone}
					/>
				</div>
				<Badge
					variant="secondary"
					className="absolute left-0 top-0 uppercase tracking-wide"
				>
					Preview · sample data
				</Badge>
				<div className="absolute inset-0 flex items-center justify-center p-4">
					<div className="max-w-md space-y-3 rounded-xl border bg-card/95 p-6 text-center shadow-lg backdrop-blur">
						<div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
							<Lock className="h-5 w-5" />
						</div>
						<h4 className="text-base font-semibold">
							Prompt cache rate is an Enterprise feature
						</h4>
						<p className="text-sm text-muted-foreground">
							See how much of each model&apos;s input is served from the
							provider prompt cache, hour by hour, so you can spot cache misses
							and cut input costs. Values shown here are sample data.
						</p>
						<ContactSalesButton />
					</div>
				</div>
			</div>
		);
	}

	if (query.isError) {
		return (
			<div className="flex h-[320px] items-center justify-center text-sm text-destructive">
				Error loading prompt cache data
			</div>
		);
	}
	if (query.isLoading || !query.data) {
		return (
			<div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
				Loading prompt cache data…
			</div>
		);
	}
	if (!query.data.timeseries.series.length) {
		return (
			<div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
				No prompt cache data for this period
			</div>
		);
	}
	return (
		<UsageTimeseriesChart
			data={query.data.timeseries}
			metric="cacheRate"
			bucket={query.data.timeseries.bucket}
			timeZone={timeZone}
		/>
	);
}
