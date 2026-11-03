import { Shuffle } from "lucide-react";
import Link from "next/link";

import { getVirtualModelPricing } from "@/lib/virtual-model-pricing";

import type { DiscountData } from "@/lib/discount";
import type { ProviderModelMapping } from "@llmgateway/models";

export function VirtualModelBanner({
	target,
	providers,
	discounts,
}: {
	target?: string;
	providers?: ProviderModelMapping[];
	discounts?: DiscountData[];
}) {
	if (!target) {
		return null;
	}
	const prices = providers
		? getVirtualModelPricing(target, providers, discounts)
		: null;
	return (
		<aside
			className="mb-6 rounded-lg border border-blue-500/25 bg-blue-500/5 p-4 text-sm"
			aria-label="Virtual model"
		>
			<div className="mb-1 flex items-center gap-2 font-semibold text-blue-700 dark:text-blue-300">
				<Shuffle className="h-4 w-4" />
				Virtual model
			</div>
			<p>
				Currently serves{" "}
				<Link
					href={`/models/${encodeURIComponent(target)}`}
					className="font-mono underline underline-offset-4"
				>
					{target}
				</Link>
				.
			</p>
			{prices && (prices.input !== null || prices.output !== null) && (
				<p className="mt-2 font-medium">
					Current cut pricing per 1M tokens:{" "}
					{prices.input !== null && <>input from ${prices.input}</>}
					{prices.input !== null && prices.output !== null && " · "}
					{prices.output !== null && <>output from ${prices.output}</>}.
				</p>
			)}
			<p className="mt-1 text-muted-foreground">
				The prices and capabilities below are for this current model cut. The
				served version and its pricing may change. Use the versioned model ID to
				pin this cut.
			</p>
		</aside>
	);
}
