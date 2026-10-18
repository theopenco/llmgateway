"use client";

import { ArrowUpRight } from "lucide-react";

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
			href={promo.announcementUrl}
			target="_blank"
			rel="noopener noreferrer"
			className="group block border-b border-neutral-200 bg-white text-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current dark:border-white/15 dark:bg-neutral-950 dark:text-white"
		>
			<div className="container mx-auto flex flex-wrap items-center justify-center gap-x-2.5 gap-y-2 px-4 py-2.5 text-[13px] font-medium leading-tight">
				<ProviderPromoContent
					key={promo.id}
					promo={promo}
					trailing={
						<ArrowUpRight
							aria-hidden="true"
							className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:transform-none"
						/>
					}
				/>
			</div>
		</a>
	);
}
