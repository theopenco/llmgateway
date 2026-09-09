import { Badge } from "@/components/ui/badge";

import { discountFraction } from "@llmgateway/shared";
import { isMappingDeactivated } from "@llmgateway/shared/components";

import type { ApiModelProviderMapping } from "@/lib/fetch-models";

export function ModelDiscountBadge({
	mappings,
	exact = false,
}: {
	mappings: Pick<
		ApiModelProviderMapping,
		"discount" | "deactivatedAt" | "status"
	>[];
	exact?: boolean;
}) {
	const discount = Math.max(
		0,
		...mappings
			.filter(
				(mapping) =>
					mapping.status === "active" && !isMappingDeactivated(mapping),
			)
			.map((mapping) => discountFraction(mapping.discount)),
	);
	return discount > 0 ? (
		<Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 text-xs">
			{!exact && "Up to "}
			{Math.round(discount * 100)}% off
		</Badge>
	) : null;
}
