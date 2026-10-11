"use client";

import {
	FilterPendingSpinner,
	useFilterNavigation,
} from "@/components/filter-navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Segmented button group whose selection lives in a URL search param. The
 * default value is represented by the param being absent, so shared links stay
 * short and the "everything" view has one canonical URL.
 *
 * `compact` renders the dense bordered variant used by the dashboard headers.
 *
 * `extraParams` are applied alongside the selection — a `null` value drops the
 * param. Use it to pin params the selection implies (the tab a filter lives in)
 * and to reset ones it invalidates (a page number of a now-shorter list).
 */
export function SegmentedUrlSelector<T extends string>({
	param,
	value,
	defaultValue,
	options,
	className,
	compact = false,
	extraParams,
}: {
	param: string;
	value: T;
	defaultValue: T;
	options: { value: T; label: string }[];
	className?: string;
	compact?: boolean;
	extraParams?: Record<string, string | null>;
}) {
	const { isPending, pendingKey, navigate } = useFilterNavigation();

	// replace + scroll:false to match the other filters on these pages:
	// push would make Back walk every toggle instead of leaving the page,
	// and the default scroll restoration jumps to the top of the document
	// when a selector below the fold is used.
	const setValue = (next: T) =>
		navigate(
			`${param}:${next}`,
			(params) => {
				if (next === defaultValue) {
					params.delete(param);
				} else {
					params.set(param, next);
				}
				for (const [key, paramValue] of Object.entries(extraParams ?? {})) {
					if (paramValue === null) {
						params.delete(key);
					} else {
						params.set(key, paramValue);
					}
				}
			},
			{ replace: true },
		);

	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-1",
				compact && "rounded-md border border-border/60 bg-background p-1",
				className,
			)}
		>
			{options.map((option) => (
				<Button
					key={option.value}
					variant={
						value === option.value ? "default" : compact ? "ghost" : "outline"
					}
					size="sm"
					className={cn(compact && "h-7 px-3 text-xs")}
					disabled={isPending}
					onClick={() => setValue(option.value)}
				>
					{pendingKey === `${param}:${option.value}` && (
						<FilterPendingSpinner className="h-3.5 w-3.5" />
					)}
					{option.label}
				</Button>
			))}
		</div>
	);
}
