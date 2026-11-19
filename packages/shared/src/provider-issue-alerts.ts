/** Choices for a user's `provider_issue` notification preference. */
export const PROVIDER_ISSUE_WINDOW_MINUTES = [5, 15, 60] as const;
export const PROVIDER_ISSUE_ERROR_RATE_PERCENTS = [10, 20, 30, 50] as const;
export const PROVIDER_ISSUE_USAGE_HOURS = [1, 4, 24] as const;

export const DEFAULT_PROVIDER_ISSUE_SETTINGS = {
	issueWindowMinutes: 15,
	issueErrorRatePercent: 30,
	issueUsageHours: 4,
} as const;

/** Requests a mapping needs in the window before its error rate is judged. */
export const PROVIDER_ISSUE_MIN_REQUESTS = 20;

export function formatAlertWindow(minutes: number): string {
	return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}
