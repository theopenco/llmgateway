"use client";

import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

import {
	ProviderPromoContent,
	useProviderPromo,
} from "@llmgateway/shared/components";

export function ProviderPromoBanner() {
	const promo = useProviderPromo();

	if (!promo) {
		return null;
	}

	return (
		<a
			href={promo.id === "scx" ? promo.announcementUrl : promo.providerUrl}
			target="_blank"
			rel="noopener noreferrer"
			className={cn(
				"group block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current",
				promo.id === "scx"
					? "border-b border-neutral-200 bg-white text-neutral-950 dark:border-white/15 dark:bg-neutral-950 dark:text-white"
					: "bg-[#a8f399] text-[#0c1a08]",
			)}
		>
			<div className="container mx-auto flex flex-wrap items-center justify-center gap-x-2.5 gap-y-2 px-4 py-2.5 text-[13px] font-medium leading-tight">
				<ProviderPromoContent key={promo.id} promo={promo} />
				<ArrowUpRight
					aria-hidden="true"
					className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:transform-none"
				/>
			</div>
		</a>
	);
}
