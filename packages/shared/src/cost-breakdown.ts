/**
 * Splits a usage row's spend into the components a stacked cost chart shows,
 * guaranteeing the segments add up to the row's total.
 *
 * `cost` is inference spend and already includes every component; data
 * storage is billed on top of it. Rollups only track input, output, cached
 * input and cache write individually, so the remainder (per-request fees,
 * image, audio, video, web search) is reported as "other". When the token
 * components exceed `cost` (discounts, or a billing-mode view where `cost` is
 * the credits/BYOK share but the components are blended) or miss it only by
 * float precision noise, they are scaled proportionally so the stack matches the
 * total exactly.
 */
export interface CostComponents {
	cost: number;
	inputCost: number;
	outputCost: number;
	cachedInputCost: number;
	cacheWriteInputCost: number;
	dataStorageCost?: number;
}

export type CostSegmentKey =
	"input" | "output" | "cachedInput" | "cacheWrite" | "other" | "storage";

export type CostSplit = Record<CostSegmentKey, number> & { total: number };

export const COST_SEGMENTS: readonly {
	key: CostSegmentKey;
	label: string;
	color: string;
}[] = [
	{ key: "input", label: "Input", color: "#3b82f6" },
	{ key: "output", label: "Output", color: "#f59e0b" },
	{ key: "cachedInput", label: "Cached input", color: "#10b981" },
	{ key: "cacheWrite", label: "Cache write", color: "#ec4899" },
	{ key: "other", label: "Other", color: "#64748b" },
	{ key: "storage", label: "Storage", color: "#6366f1" },
];

// Rollup costs are float4 (~7 significant digits), so summing a range of
// hourly rows drifts by roughly 1e-5 of the total at most. A gap inside that
// bound is precision noise; anything larger is a real non-token fee.
const FLOAT_RELATIVE_TOLERANCE = 1e-5;
const FLOAT_ABSOLUTE_TOLERANCE = 1e-6;

function nonNegative(value: number | null | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

export function splitCost(row: CostComponents): CostSplit {
	const cost = nonNegative(row.cost);
	const storage = nonNegative(row.dataStorageCost);
	const tokens = {
		input: nonNegative(row.inputCost),
		output: nonNegative(row.outputCost),
		cachedInput: nonNegative(row.cachedInputCost),
		cacheWrite: nonNegative(row.cacheWriteInputCost),
	};
	const tokenTotal =
		tokens.input + tokens.output + tokens.cachedInput + tokens.cacheWrite;
	const tolerance = Math.max(
		cost * FLOAT_RELATIVE_TOLERANCE,
		FLOAT_ABSOLUTE_TOLERANCE,
	);
	// Fit the token components to cost exactly when they overshoot it or the
	// gap is only float noise; otherwise the gap is real "other" spend.
	const fitted = tokenTotal > 0 && cost - tokenTotal <= tolerance;
	const scale = fitted ? cost / tokenTotal : 1;
	return {
		input: tokens.input * scale,
		output: tokens.output * scale,
		cachedInput: tokens.cachedInput * scale,
		cacheWrite: tokens.cacheWrite * scale,
		other: fitted ? 0 : cost - tokenTotal,
		storage,
		total: cost + storage,
	};
}
