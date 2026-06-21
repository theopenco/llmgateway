"use client";

import { format, subDays } from "date-fns";
import { ChevronDownIcon, Lock, Mail } from "lucide-react";

import { DateRangePicker } from "@/components/date-range-picker";
import { Button } from "@/lib/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";

/**
 * Date window non-enterprise plans can see on the new analytics pages. Custom
 * ranges (any week/month/quarter) are reserved for the enterprise plan.
 */
export const FREE_PLAN_RANGE_DAYS = 7;

/**
 * Resolves the effective from/to range for an analytics page. Enterprise plans
 * honour the URL params (driven by the full date picker); everyone else is
 * clamped to the last {@link FREE_PLAN_RANGE_DAYS} days regardless of the URL,
 * so the limit can't be bypassed by editing query params.
 */
export function getAnalyticsRange(
	isEnterprise: boolean,
	searchFrom: string | null,
	searchTo: string | null,
): { fromStr: string; toStr: string } {
	const today = new Date();
	const defaultFrom = format(
		subDays(today, FREE_PLAN_RANGE_DAYS - 1),
		"yyyy-MM-dd",
	);
	const defaultTo = format(today, "yyyy-MM-dd");

	if (!isEnterprise) {
		return { fromStr: defaultFrom, toStr: defaultTo };
	}

	return {
		fromStr: searchFrom ?? defaultFrom,
		toStr: searchTo ?? defaultTo,
	};
}

interface AnalyticsDateRangeProps {
	isEnterprise: boolean;
	buildUrl: (path?: string) => string;
	path: string;
}

/**
 * The full {@link DateRangePicker} for enterprise plans, or a locked
 * "Last 7 days" control with an inline upsell for everyone else.
 */
export function AnalyticsDateRange({
	isEnterprise,
	buildUrl,
	path,
}: AnalyticsDateRangeProps) {
	if (isEnterprise) {
		return <DateRangePicker buildUrl={buildUrl} path={path} />;
	}

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="border-input hover:bg-accent hover:text-accent-foreground flex h-9 items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
				>
					<Lock className="h-3.5 w-3.5 opacity-60" />
					Last 7 days
					<ChevronDownIcon className="h-4 w-4 opacity-50" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80">
				<div className="space-y-3">
					<div className="space-y-1">
						<h4 className="text-sm font-semibold">Want a longer history?</h4>
						<p className="text-muted-foreground text-sm">
							Your plan shows the last 7 days. Upgrade to Enterprise to break
							usage down across any week, month, or quarter.
						</p>
					</div>
					<Button asChild size="sm" className="w-full">
						<a href="mailto:contact@llmgateway.io">
							<Mail className="mr-2 h-4 w-4" />
							Contact sales
						</a>
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
