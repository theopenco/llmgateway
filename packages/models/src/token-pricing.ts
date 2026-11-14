import type { ProviderModelMapping } from "./models.js";

type TokenPriceFields = Pick<
	ProviderModelMapping,
	| "inputPrice"
	| "outputPrice"
	| "requestPrice"
	| "perImagePrice"
	| "perSecondPrice"
	| "videoOutputPrice"
	| "imageOutputPrice"
	| "ocrPagePrice"
	| "inputCharacterPrice"
	| "inputAudioHourPrice"
	| "inputTextItemPrice"
>;

/**
 * Whether input and output token prices describe what a request on this
 * mapping costs. False for mappings billed per image, second, page, character
 * or request, whose token prices are zero or only part of the bill.
 */
export function isTokenPricedMapping(mapping: TokenPriceFields): boolean {
	return (
		mapping.inputPrice !== undefined &&
		mapping.outputPrice !== undefined &&
		mapping.perImagePrice === undefined &&
		mapping.perSecondPrice === undefined &&
		mapping.videoOutputPrice === undefined &&
		mapping.imageOutputPrice === undefined &&
		mapping.ocrPagePrice === undefined &&
		mapping.inputCharacterPrice === undefined &&
		mapping.inputAudioHourPrice === undefined &&
		mapping.inputTextItemPrice === undefined &&
		(mapping.requestPrice === undefined || Number(mapping.requestPrice) === 0)
	);
}
