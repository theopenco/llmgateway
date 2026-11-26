export interface VideoTokenPriceOptions {
	resolution?: string | null;
	includeAudio?: boolean | null;
	hasVideoInput?: boolean;
}

export function getVideoOutputTokenPrice(
	pricing: string | Record<string, string> | null | undefined,
	options: VideoTokenPriceOptions,
): string | undefined {
	const resolution = options.resolution?.toLowerCase() ?? "720p";
	const inputKind = options.hasVideoInput ? "with_video" : "without_video";
	const outputKind = options.includeAudio === false ? "video" : "audio";
	const keys = [
		`${resolution}_${inputKind}`,
		`${resolution}_${outputKind}`,
		resolution,
		`default_${inputKind}`,
		`default_${outputKind}`,
		"default",
	];
	const price =
		typeof pricing === "string"
			? pricing
			: keys.map((key) => pricing?.[key]).find((value) => value !== undefined);
	if (price === undefined || price.trim() === "") {
		return undefined;
	}
	const numericPrice = Number(price);
	return Number.isFinite(numericPrice) && numericPrice >= 0 ? price : undefined;
}
