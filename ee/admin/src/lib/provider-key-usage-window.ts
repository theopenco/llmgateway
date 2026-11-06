export type UsageWindow = "all" | "1d" | "7d" | "30d";

export const USAGE_WINDOW_OPTIONS: { value: UsageWindow; label: string }[] = [
	{ value: "all", label: "All time" },
	{ value: "1d", label: "24h" },
	{ value: "7d", label: "7d" },
	{ value: "30d", label: "30d" },
];

export function parseUsageWindow(
	value: string | null | undefined,
): UsageWindow {
	return (
		USAGE_WINDOW_OPTIONS.find((option) => option.value === value)?.value ??
		"all"
	);
}

export function usageWindowLabel(window: UsageWindow): string {
	return USAGE_WINDOW_OPTIONS.find((option) => option.value === window)!.label;
}
