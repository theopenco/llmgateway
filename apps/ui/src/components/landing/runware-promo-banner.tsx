"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { RUNWARE_PROMO } from "@llmgateway/shared";
import {
	formatCountdown,
	RunwareWordmarkIcon,
	useCountdown,
} from "@llmgateway/shared/components";

interface RunwarePromoBannerProps {
	// Collapses the banner once the floating navbar pill takes over on scroll.
	collapsed?: boolean;
}

export function RunwarePromoBanner({
	collapsed = false,
}: RunwarePromoBannerProps) {
	const countdown = useCountdown(RUNWARE_PROMO.endsAt);

	if (countdown.expired) {
		return null;
	}

	return (
		<div
			inert={collapsed || undefined}
			className={cn(
				"grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
				collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
			)}
		>
			<div className="min-h-0 overflow-hidden">
				<div className="mx-auto max-w-[1400px] pt-2">
					<Link
						href={RUNWARE_PROMO.providerPath}
						prefetch={true}
						className="group/promo flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 rounded-2xl bg-[#a8f399] px-4 py-2 text-[#0c1a08]"
					>
						<RunwareWordmarkIcon
							className="h-3 w-auto shrink-0"
							aria-label="Runware"
							role="img"
						/>
						<span className="text-[13px] font-medium leading-tight">
							<span className="hidden sm:inline">is now on LLM Gateway — </span>
							<span className="font-semibold">
								{RUNWARE_PROMO.discountPercent}% off
							</span>{" "}
							open-source models
						</span>
						<span
							suppressHydrationWarning
							className="rounded-full bg-[#0c1a08]/10 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums leading-tight"
						>
							ends in {formatCountdown(countdown)}
						</span>
						<ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out group-hover/promo:translate-x-0.5" />
					</Link>
				</div>
			</div>
		</div>
	);
}
