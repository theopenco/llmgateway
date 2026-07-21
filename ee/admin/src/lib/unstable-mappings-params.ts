export type UnstableWindow =
	| "1h"
	| "2h"
	| "4h"
	| "8h"
	| "12h"
	| "16h"
	| "24h"
	| "3d"
	| "7d";

export const UNSTABLE_WINDOW_DEFAULT: UnstableWindow = "4h";

export const UNSTABLE_WINDOW_OPTIONS: {
	value: UnstableWindow;
	label: string;
}[] = [
	{ value: "1h", label: "1h" },
	{ value: "2h", label: "2h" },
	{ value: "4h", label: "4h" },
	{ value: "8h", label: "8h" },
	{ value: "12h", label: "12h" },
	{ value: "16h", label: "16h" },
	{ value: "24h", label: "24h" },
	{ value: "3d", label: "3d" },
	{ value: "7d", label: "7d" },
];

export const UNSTABLE_WINDOW_LABELS: Record<UnstableWindow, string> = {
	"1h": "1 hour",
	"2h": "2 hours",
	"4h": "4 hours",
	"8h": "8 hours",
	"12h": "12 hours",
	"16h": "16 hours",
	"24h": "24 hours",
	"3d": "3 days",
	"7d": "7 days",
};

export function parseUnstableWindow(value: string | undefined): UnstableWindow {
	return UNSTABLE_WINDOW_OPTIONS.some((option) => option.value === value)
		? (value as UnstableWindow)
		: UNSTABLE_WINDOW_DEFAULT;
}

export const UNSTABLE_LOG_LIMIT_DEFAULT = 100;
export const UNSTABLE_LOG_LIMIT_MAX = 1000000;

export const UNSTABLE_LOG_LIMIT_OPTIONS: { value: string; label: string }[] = [
	{ value: "100", label: "100" },
	{ value: "500", label: "500" },
	{ value: "1000", label: "1,000" },
	{ value: "5000", label: "5,000" },
	{ value: "10000", label: "10k" },
	{ value: "100000", label: "100k" },
	{ value: "1000000", label: "1m" },
];

// Accepts any value in [1, MAX] so hand-crafted dashboard links work, snapping
// back to the default only when missing or out of range.
export function parseUnstableLogLimit(value: string | undefined): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return UNSTABLE_LOG_LIMIT_DEFAULT;
	}
	return Math.min(Math.floor(parsed), UNSTABLE_LOG_LIMIT_MAX);
}
