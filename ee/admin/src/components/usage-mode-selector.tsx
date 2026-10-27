"use client";

import { useSearchParams } from "next/navigation";

import { SegmentedUrlSelector } from "@/components/segmented-url-selector";
import {
	CATALOG_USAGE_MODE_DEFAULT,
	parseUsageMode,
	USAGE_MODE_OPTIONS,
	usageModeDescription,
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

/** Usage-mode selector for provider, model and mapping detail pages. */
export function CatalogDetailUsageMode() {
	const description = usageModeDescription(
		useUsageMode(CATALOG_USAGE_MODE_DEFAULT),
	);
	return (
		<div className="flex flex-wrap items-center gap-2">
			<UsageModeSelector compact defaultMode={CATALOG_USAGE_MODE_DEFAULT} />
			{description && (
				<span className="text-xs text-muted-foreground">{description}</span>
			)}
		</div>
	);
}
