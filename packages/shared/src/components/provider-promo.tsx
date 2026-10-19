"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import { getActiveProviderPromo } from "@/marketing";

import { ScxIcon } from "./provider-icons";
import { formatCountdown, useCountdown } from "./use-countdown";

function subscribe(onChange: () => void) {
	const interval = setInterval(onChange, 1000);
	return () => clearInterval(interval);
}

// Cached HTML must not hydrate with a campaign selected at build time.
export function useProviderPromo() {
	return useSyncExternalStore(subscribe, getActiveProviderPromo, () => null);
}

export function ProviderPromoContent({
	promo,
	trailing,
}: {
	promo: NonNullable<ReturnType<typeof getActiveProviderPromo>>;
	// Rendered on the countdown's line so it never wraps alone.
	trailing?: ReactNode;
}) {
	const countdown = useCountdown(promo.endsAt);

	return (
		<>
			<ScxIcon className="h-5 w-auto shrink-0" aria-label="SCX.ai" role="img" />
			<span className="text-[13px] font-medium leading-tight">
				<span className="mr-1 rounded-md bg-neutral-950 px-2 py-1 font-semibold text-white dark:bg-white dark:text-neutral-950">
					{promo.discountPercent}% off
				</span>{" "}
				{promo.modelCount} SCX models
			</span>
			<span className="inline-flex items-center gap-2.5 whitespace-nowrap">
				<span
					suppressHydrationWarning
					className="rounded-full bg-black/10 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums leading-tight dark:bg-white/10"
				>
					ends in {formatCountdown(countdown)}
				</span>
				<span className="hidden text-xs font-medium lg:inline">View offer</span>
				{trailing}
			</span>
		</>
	);
}
