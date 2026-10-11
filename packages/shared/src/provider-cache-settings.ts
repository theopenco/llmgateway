export const AUTOMATIC_CACHE_DURATION_DESCRIPTION =
	"Used for automatically added cache markers when your request contains none. One hour applies only to supported models and providers; otherwise the default duration is used. Longer cache durations can increase cache-write costs.";

export const AUTOMATIC_CACHE_DURATION_OPTIONS = [
	{ value: "5m", label: "5 minutes (default)" },
	{ value: "1h", label: "1 hour" },
] as const;
