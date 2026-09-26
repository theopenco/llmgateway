import { formatCompactNumber } from "@llmgateway/shared/number-format";

/**
 * Request-rate formatting. Gateway load spans several orders of magnitude —
 * a quiet model sits at 0.02 rps while the platform total runs in the
 * thousands — so the precision follows the magnitude instead of being fixed:
 * a flat 2 decimals would render "1,432.00" and a flat 0 would render every
 * small series as "0".
 */
export function formatRps(value: number): string {
	if (!Number.isFinite(value) || value <= 0) {
		return "0";
	}
	if (value < 0.01) {
		return "<0.01";
	}
	if (value < 10) {
		return value.toFixed(2);
	}
	if (value < 100) {
		return value.toFixed(1);
	}
	if (value < 10_000) {
		return Math.round(value).toLocaleString("en-US");
	}
	return formatCompactNumber(value);
}

export function formatRpsWithUnit(value: number): string {
	return `${formatRps(value)} req/s`;
}

export function formatShare(share: number): string {
	if (!Number.isFinite(share) || share <= 0) {
		return "0%";
	}
	if (share < 0.001) {
		return "<0.1%";
	}
	return `${(share * 100).toFixed(1)}%`;
}
