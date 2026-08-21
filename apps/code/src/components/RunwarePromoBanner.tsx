"use client";

import { ArrowUpRight } from "lucide-react";

import { RUNWARE_PROMO } from "@llmgateway/shared";
import {
	formatCountdown,
	RunwareWordmarkIcon,
	useCountdown,
} from "@llmgateway/shared/components";

export function RunwarePromoBanner() {
	const countdown = useCountdown(RUNWARE_PROMO.endsAt);

	if (countdown.expired) {
		return null;
	}

	return (
		<a
			href={RUNWARE_PROMO.providerUrl}
			target="_blank"
			rel="noopener noreferrer"
			className="group block bg-[#a8f399] text-[#0c1a08]"
		>
			<div className="container mx-auto flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-4 py-2 text-[13px] font-medium leading-tight">
				<RunwareWordmarkIcon
					className="h-2.5 w-auto shrink-0"
					aria-label="Runware"
					role="img"
				/>
				<span>
					<span className="hidden sm:inline">is now on LLM Gateway — </span>
					<span className="font-semibold">
						{RUNWARE_PROMO.discountPercent}% off
					</span>{" "}
					open-source models
				</span>
				<span
					suppressHydrationWarning
					className="rounded bg-[#0c1a08]/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums"
				>
					ends in {formatCountdown(countdown)}
				</span>
				<ArrowUpRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
			</div>
		</a>
	);
}
