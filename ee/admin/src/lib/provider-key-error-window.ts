/** Windows the credentials table can show its error rate over. */
export type ErrorWindow = "all" | "4h" | "1d" | "7d" | "30d";

export const DEFAULT_ERROR_WINDOW: ErrorWindow = "7d";

export const ERROR_WINDOW_OPTIONS: {
	value: ErrorWindow;
	/** Short form for the column header. */
	short: string;
	label: string;
	/** What one sparkline point covers. */
	bucket: string;
}[] = [
	{
		value: "all",
		short: "All time",
		label: "entire history",
		bucket: "UTC month",
	},
	{ value: "4h", short: "4h", label: "last 4 hours", bucket: "hour" },
	{ value: "1d", short: "24h", label: "last 24 hours", bucket: "hour" },
	{ value: "7d", short: "7d", label: "last 7 days", bucket: "UTC day" },
	{ value: "30d", short: "30d", label: "last 30 days", bucket: "UTC day" },
];

export function errorWindowOption(window: ErrorWindow) {
	return (
		ERROR_WINDOW_OPTIONS.find((option) => option.value === window) ??
		ERROR_WINDOW_OPTIONS.find(
			(option) => option.value === DEFAULT_ERROR_WINDOW,
		)!
	);
}
