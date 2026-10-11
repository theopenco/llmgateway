/** Windows the credentials table can show its error rate over. */
export type ErrorWindow = "4h" | "1d" | "7d";

export const DEFAULT_ERROR_WINDOW: ErrorWindow = "1d";

export const ERROR_WINDOW_OPTIONS: {
	value: ErrorWindow;
	/** Short form for the column header. */
	short: string;
	label: string;
	/** What one sparkline point covers. */
	bucket: string;
}[] = [
	{ value: "4h", short: "4h", label: "last 4 hours", bucket: "hour" },
	{ value: "1d", short: "24h", label: "last 24 hours", bucket: "hour" },
	{ value: "7d", short: "7d", label: "last 7 days", bucket: "UTC day" },
];

export function parseErrorWindow(value: string | null | undefined) {
	return (
		ERROR_WINDOW_OPTIONS.find((option) => option.value === value)?.value ??
		DEFAULT_ERROR_WINDOW
	);
}

export function errorWindowOption(window: ErrorWindow) {
	return (
		ERROR_WINDOW_OPTIONS.find((option) => option.value === window) ??
		ERROR_WINDOW_OPTIONS[1]
	);
}
