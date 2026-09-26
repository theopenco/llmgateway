/**
 * Formats a 0–1 error rate. Healthy models sit well under one percent, so small
 * rates keep two decimals instead of rounding a real 0.04% down to "0.0%".
 * `null` means no eligible request in scope and renders as an em dash, never
 * as 0%.
 */
export function formatErrorRate(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return "—";
	}
	if (value <= 0) {
		return "0%";
	}
	const percent = value * 100;
	if (percent < 0.01) {
		return "<0.01%";
	}
	return `${percent.toFixed(percent < 10 ? 2 : 1)}%`;
}
