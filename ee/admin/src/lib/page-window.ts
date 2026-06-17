export type PageWindow =
	| "1m"
	| "2m"
	| "5m"
	| "15m"
	| "1h"
	| "2h"
	| "4h"
	| "12h"
	| "24h"
	| "2d"
	| "3d"
	| "7d"
	| "30d"
	| "90d";

export const pageWindowOptions: { value: PageWindow; label: string }[] = [
	{ value: "1h", label: "1h" },
	{ value: "2h", label: "2h" },
	{ value: "4h", label: "4h" },
	{ value: "12h", label: "12h" },
	{ value: "24h", label: "24h" },
	{ value: "2d", label: "2d" },
	{ value: "3d", label: "3d" },
	{ value: "7d", label: "7d" },
	{ value: "30d", label: "30d" },
	{ value: "90d", label: "90d" },
];

export const pageWindowOptionsWithMinutes: {
	value: PageWindow;
	label: string;
}[] = [
	{ value: "1m", label: "1m" },
	{ value: "2m", label: "2m" },
	{ value: "5m", label: "5m" },
	{ value: "15m", label: "15m" },
	...pageWindowOptions,
];

const allValidWindows = new Set<PageWindow>([
	"1m",
	"2m",
	"5m",
	"15m",
	"1h",
	"2h",
	"4h",
	"12h",
	"24h",
	"2d",
	"3d",
	"7d",
	"30d",
	"90d",
]);

// Windows longer than 24h are aggregated from the hourly rollup tables; 24h and
// below from the per-minute history tables. Mirrors the API's hourly threshold.
const HOURLY_PAGE_WINDOWS = new Set<PageWindow>([
	"2d",
	"3d",
	"7d",
	"30d",
	"90d",
]);

export function pageBucketSource(window: PageWindow): "hourly" | "minute" {
	return HOURLY_PAGE_WINDOWS.has(window) ? "hourly" : "minute";
}

export function parsePageWindow(value: string | undefined): PageWindow {
	if (value && allValidWindows.has(value as PageWindow)) {
		return value as PageWindow;
	}
	return "4h";
}

export function windowToFromTo(window: PageWindow): {
	from: string;
	to: string;
} {
	const now = new Date();
	const windowMinutes: Record<PageWindow, number> = {
		"1m": 1,
		"2m": 2,
		"5m": 5,
		"15m": 15,
		"1h": 60,
		"2h": 120,
		"4h": 240,
		"12h": 720,
		"24h": 1440,
		"2d": 2880,
		"3d": 4320,
		"7d": 10080,
		"30d": 43200,
		"90d": 129600,
	};
	const minutes = windowMinutes[window];
	const ms = minutes * 60 * 1000;
	const from = new Date(now.getTime() - ms).toISOString();
	return { from, to: now.toISOString() };
}
