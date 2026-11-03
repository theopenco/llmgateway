import Decimal from "decimal.js";

import {
	expandAllProviderRegions,
	resolveTimeBasedPricing,
	type ProviderModelMapping,
} from "@llmgateway/models";
import { isMappingDeactivated } from "@llmgateway/shared/components";

import { getEffectiveProviderDiscount, type DiscountData } from "./discount";

export function getVirtualModelPricing(
	target: string,
	providers: ProviderModelMapping[],
	discounts: DiscountData[] = [],
) {
	const active = expandAllProviderRegions(providers).filter(
		(mapping) => !isMappingDeactivated(mapping),
	);
	const minimum = (kind: "inputPrice" | "outputPrice") => {
		const prices = active
			.filter((mapping) => mapping[kind] !== undefined || mapping.peakPricing)
			.map((mapping) => {
				const price = resolveTimeBasedPricing(mapping)[kind];
				const discount =
					getEffectiveProviderDiscount(discounts, mapping.providerId, target) ??
					"0";
				return new Decimal(price).mul(new Decimal(1).minus(discount)).mul(1e6);
			});
		return prices.length ? Decimal.min(...prices).toString() : null;
	};
	return { input: minimum("inputPrice"), output: minimum("outputPrice") };
}
