"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
	parseUsageMode,
	USAGE_MODE_OPTIONS,
	type UsageMode,
} from "@/lib/usage-mode";

/** Reads the current billing-mode view from the `mode` URL search param. */
export function useUsageMode(): UsageMode {
	const searchParams = useSearchParams();
	return parseUsageMode(searchParams.get("mode"));
}

/**
 * All / Credits / BYOK toggle for admin usage views, persisted in the `mode`
 * URL search param. Credits = billed against the org balance; BYOK = served by
 * the org's own provider keys (not billed).
 */
export function UsageModeSelector() {
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
		<div className="flex items-center gap-1">
			{USAGE_MODE_OPTIONS.map((option) => (
				<Button
					key={option.value}
					variant={mode === option.value ? "default" : "outline"}
					size="sm"
					onClick={() => setMode(option.value)}
				>
					{option.label}
				</Button>
			))}
		</div>
	);
}
