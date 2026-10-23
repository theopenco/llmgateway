"use client";

import { useSearchParams } from "next/navigation";

import { SegmentedUrlSelector } from "@/components/segmented-url-selector";
import {
	parseUsageMode,
	USAGE_MODE_OPTIONS,
	type UsageMode,
} from "@/lib/usage-mode";

/** Reads the current billing-mode view from the `mode` URL search param. */
export function useUsageMode(defaultMode: UsageMode = "total"): UsageMode {
	const searchParams = useSearchParams();
	return parseUsageMode(searchParams.get("mode"), defaultMode);
}

/**
 * All / Credits / Bring Your Own Key toggle for admin usage views, persisted in the `mode`
 * URL search param. Credits = billed against the org balance; BYOK = served by
 * the org's own provider keys (not billed).
 */
export function UsageModeSelector({
	className,
	compact = false,
	extraParams,
	defaultMode = "total",
}: {
	className?: string;
	compact?: boolean;
	extraParams?: Record<string, string | null>;
	defaultMode?: UsageMode;
} = {}) {
	return (
		<SegmentedUrlSelector
			param="mode"
			value={useUsageMode(defaultMode)}
			defaultValue={defaultMode}
			options={USAGE_MODE_OPTIONS}
			className={className}
			compact={compact}
			extraParams={extraParams}
		/>
	);
}
