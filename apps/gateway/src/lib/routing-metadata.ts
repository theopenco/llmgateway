import type { RoutingMetadata } from "@llmgateway/actions";

export function getNoFallbackRoutingMetadata(
	noFallback: boolean,
	xNoFallbackHeaderSet: boolean,
): Partial<RoutingMetadata> {
	return {
		...(noFallback ? { noFallback: true } : {}),
		...(xNoFallbackHeaderSet ? { xNoFallbackHeaderSet: true } : {}),
	};
}
