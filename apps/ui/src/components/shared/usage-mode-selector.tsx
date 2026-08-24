"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
 * Segmented All / Credits / BYOK toggle for usage pages. Stores the selection
 * in the `mode` URL search param so it survives navigation and can be shared.
 */
export function UsageModeSelector({ className }: { className?: string }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const mode = parseUsageMode(searchParams.get("mode"));

	const setMode = (next: UsageMode) => {
		const params = new URLSearchParams(searchParams.toString());
		if (next === "total") {
			params.delete("mode");
		} else {
			params.set("mode", next);
		}
		const query = params.toString();
		router.replace(query ? `${pathname}?${query}` : pathname, {
			scroll: false,
		});
	};

	return (
		<div
			className={cn(
				"inline-flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5",
				className,
			)}
		>
			{USAGE_MODE_OPTIONS.map((option) => (
				<button
					key={option.value}
					type="button"
					onClick={() => setMode(option.value)}
					title={
						option.value === "api-keys"
							? "Usage served by your own provider keys (not billed to credits)"
							: option.value === "credits"
								? "Usage billed against your credit balance"
								: "All traffic"
					}
					className={cn(
						"rounded-md px-3 py-1 text-xs font-medium transition-colors",
						mode === option.value
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}
