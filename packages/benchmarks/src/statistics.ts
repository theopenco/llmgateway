import type { NumericSummary } from "./types.js";

export function summarizeNumbers(
	values: ReadonlyArray<number | null | undefined>,
): NumericSummary | null {
	const sorted = values
		.filter((value): value is number =>
			Number.isFinite(typeof value === "number" ? value : Number.NaN),
		)
		.sort((left, right) => left - right);
	if (sorted.length === 0) {
		return null;
	}
	const percentile = (fraction: number): number =>
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
	return {
		count: sorted.length,
		min: sorted[0],
		mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
		p50: percentile(0.5),
		p95: percentile(0.95),
		max: sorted.at(-1) ?? sorted[0],
	};
}
