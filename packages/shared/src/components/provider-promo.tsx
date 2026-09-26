"use client";

import { useSyncExternalStore } from "react";

import { getActiveProviderPromo } from "@/marketing";

import { RunwareWordmarkIcon, ScxIcon } from "./provider-icons";
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
}: {
	promo: NonNullable<ReturnType<typeof getActiveProviderPromo>>;
}) {
	const countdown = useCountdown(promo.endsAt);
	const isScx = promo.id === "scx";
	const Logo = isScx ? ScxIcon : RunwareWordmarkIcon;

	return (
		<>
			<Logo
				className={isScx ? "h-5 w-auto shrink-0" : "h-3 w-auto shrink-0"}
				aria-label={isScx ? "SCX.ai" : "Runware"}
				role="img"
			/>
			<span className="text-[13px] font-medium leading-tight">
				{!isScx && (
					<span className="hidden sm:inline">is now on LLM Gateway — </span>
				)}
				<span
					className={
						isScx
							? "mr-1 rounded-md bg-neutral-950 px-2 py-1 font-semibold text-white dark:bg-white dark:text-neutral-950"
							: "font-semibold"
					}
				>
					{promo.discountPercent}% off
				</span>{" "}
				{isScx ? `${promo.modelCount} SCX models` : "open-source models"}
			</span>
			<span
				suppressHydrationWarning
				className="rounded-full bg-black/10 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums leading-tight dark:bg-white/10"
			>
				ends in {formatCountdown(countdown)}
			</span>
			{isScx && (
				<span className="hidden text-xs font-medium lg:inline">View offer</span>
			)}
		</>
	);
}
