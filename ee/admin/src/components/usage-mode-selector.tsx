"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
	parseUsageMode,
	USAGE_MODE_OPTIONS,
	type UsageMode,
} from "@/lib/usage-mode";
import { cn } from "@/lib/utils";

/** Reads the current billing-mode view from the `mode` URL search param. */
export function useUsageMode(): UsageMode {
	const searchParams = useSearchParams();
	return parseUsageMode(searchParams.get("mode"));
}

/**
 * All / Credits / BYOK toggle for admin usage views, persisted in the `mode`
 * URL search param. Credits = billed against the org balance; BYOK = served by
 * the org's own provider keys (not billed).
 *
 * `compact` renders it as a segmented group matching the dense toggles used on
 * the global stats page.
 */
export function UsageModeSelector({
	className,
	compact = false,
}: {
	className?: string;
	compact?: boolean;
} = {}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const mode = parseUsageMode(searchParams.get("mode"));

	const setMode = useCallback(
		(next: UsageMode) => {
			const params = new URLSearchParams(searchParams.toString());
			if (next === "total") {
				params.delete("mode");
			} else {
				params.set("mode", next);
			}
			const query = params.toString();
			router.push(query ? `${pathname}?${query}` : pathname);
		},
		[searchParams, router, pathname],
	);

	return (
		<div
			className={cn(
				"flex items-center gap-1",
				compact && "rounded-md border border-border/60 bg-background p-1",
				className,
			)}
		>
			{USAGE_MODE_OPTIONS.map((option) => (
				<Button
					key={option.value}
					variant={
						mode === option.value ? "default" : compact ? "ghost" : "outline"
					}
					size="sm"
					className={cn(compact && "h-7 px-3 text-xs")}
					onClick={() => setMode(option.value)}
				>
					{option.label}
				</Button>
			))}
		</div>
	);
}
