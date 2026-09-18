const numberFormatter = new Intl.NumberFormat("en-US");
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});

/** Stable digit grouping across server rendering and browser locales. */
export function formatNumber(value: number | bigint): string {
	return numberFormatter.format(value);
}

/** Compact counts for chart axes and summaries, including unit rollover. */
export function formatCompactNumber(value: number): string {
	return compactNumberFormatter.format(value).replace("K", "k");
}

export function formatChartValue(
	value: number | string | (number | string)[],
): string {
	if (Array.isArray(value)) {
		return value.map(formatChartValue).join(", ");
	}
	return typeof value === "number" ? formatNumber(value) : value;
}
