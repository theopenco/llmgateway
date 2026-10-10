"use client";

import {
	FilterPendingSpinner,
	useFilterNavigation,
} from "@/components/filter-navigation";
import { Button } from "@/components/ui/button";
import { pageBucketSource, pageWindowOptions } from "@/lib/page-window";

import type { PageWindow } from "@/lib/page-window";

export function TimeWindowSelector({
	current,
	options = pageWindowOptions,
}: {
	current: PageWindow;
	options?: { value: PageWindow; label: string }[];
}) {
	const { isPending, pendingKey, navigate } = useFilterNavigation();

	const handleSelect = (w: PageWindow) =>
		navigate(`window:${w}`, (params) => {
			params.set("window", w);
			params.delete("from");
			params.delete("to");
			params.delete("page");
		});

	return (
		<div className="flex flex-wrap items-center gap-2">
			<div className="flex flex-wrap items-center gap-1">
				{options.map((opt) => (
					<Button
						key={opt.value}
						variant={current === opt.value ? "default" : "outline"}
						size="sm"
						disabled={isPending}
						onClick={() => handleSelect(opt.value)}
					>
						{pendingKey === `window:${opt.value}` && (
							<FilterPendingSpinner className="h-3.5 w-3.5" />
						)}
						{opt.label}
					</Button>
				))}
			</div>
			<span
				className="rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
				title={
					pageBucketSource(current) === "hourly"
						? "Aggregated from the hourly rollup tables (windows > 24h)"
						: "Aggregated from the per-minute history tables (windows ≤ 24h)"
				}
			>
				{pageBucketSource(current)} buckets
			</span>
		</div>
	);
}
