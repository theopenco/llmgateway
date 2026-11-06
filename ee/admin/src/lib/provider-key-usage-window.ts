import {
	ERROR_WINDOW_OPTIONS,
	DEFAULT_ERROR_WINDOW,
} from "./provider-key-error-window";

import type { ErrorWindow } from "./provider-key-error-window";

export type UsageWindow = ErrorWindow;

export const USAGE_WINDOW_OPTIONS: { value: UsageWindow; label: string }[] =
	ERROR_WINDOW_OPTIONS.map(({ value, short }) => ({ value, label: short }));

export function parseUsageWindow(
	value: string | null | undefined,
): UsageWindow {
	return (
		USAGE_WINDOW_OPTIONS.find((option) => option.value === value)?.value ??
		DEFAULT_ERROR_WINDOW
	);
}

export function usageWindowLabel(window: UsageWindow): string {
	return USAGE_WINDOW_OPTIONS.find((option) => option.value === window)!.label;
}
export function resolveCredentialPeriod(params: {
	period?: string | null;
	usage?: string | null;
	errors?: string | null;
}): UsageWindow {
	return parseUsageWindow(params.period ?? params.usage ?? params.errors);
}
