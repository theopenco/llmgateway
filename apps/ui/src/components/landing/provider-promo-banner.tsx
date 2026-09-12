"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import {
	ProviderPromoContent,
	useProviderPromo,
} from "@llmgateway/shared/components";

interface ProviderPromoBannerProps {
	// Collapses the banner once the floating navbar pill takes over on scroll.
	collapsed?: boolean;
}

export function ProviderPromoBanner({
	collapsed = false,
}: ProviderPromoBannerProps) {
	const promo = useProviderPromo();

	if (!promo) {
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
						href={
							promo.id === "scx" ? promo.announcementPath : promo.providerPath
						}
						prefetch={true}
						className={cn(
							"group/promo flex flex-wrap items-center justify-center gap-x-2.5 gap-y-2 rounded-2xl px-4 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current",
							promo.id === "scx"
								? "border border-neutral-200 bg-white text-neutral-950 dark:border-white/15 dark:bg-neutral-950 dark:text-white"
								: "bg-[#a8f399] text-[#0c1a08]",
						)}
					>
						<ProviderPromoContent key={promo.id} promo={promo} />
						<ArrowRight
							aria-hidden="true"
							className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out group-hover/promo:translate-x-0.5 motion-reduce:transition-none motion-reduce:transform-none"
						/>
					</Link>
				</div>
			</div>
		</div>
	);
}
