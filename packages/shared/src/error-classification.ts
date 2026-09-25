export interface ErrorClassification {
	label: string;
	badgeClass: string;
	/** Whose fault it is and what it means for retries and uptime. */
	hint: string;
}

// The gateway's classification of a failed request (the log's
// `unified_finish_reason`). The HTTP status alone is misleading: some 4xx
// responses are gateway or upstream errors.
export const ERROR_CLASSIFICATIONS: Record<string, ErrorClassification> = {
	client_error: {
		label: "Client error",
		badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
		hint: "Caller's fault · not retried · excluded from error rate and uptime",
	},
	gateway_error: {
		label: "Gateway error",
		badgeClass: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
		hint: "LLM Gateway's side · retried on another key or provider",
	},
	upstream_error: {
		label: "Upstream error",
		badgeClass: "bg-red-500/15 text-red-600 dark:text-red-400",
		hint: "Provider's side · retried on another key or provider · counts against provider uptime",
	},
	content_filter: {
		label: "Content filter",
		badgeClass: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
		hint: "Blocked by a content filter · not retried",
	},
	canceled: {
		label: "Canceled",
		badgeClass: "bg-muted text-muted-foreground",
		hint: "Caller disconnected first · not retried · not an outage signal",
	},
};

export const INCIDENT_BREAKDOWN_DESCRIPTION =
	"Only upstream and gateway errors count: both are retried on another key or provider, and upstream errors count against the provider's uptime. Client errors, canceled requests, and content-filtered requests are excluded.";

// Activity-log error filter. `any` covers every errored request; the rest
// narrow to a single `unified_finish_reason` class.
export const LOG_ERROR_TYPES = [
	"all",
	"any",
	"client_error",
	"gateway_error",
	"upstream_error",
] as const;

export type LogErrorType = (typeof LOG_ERROR_TYPES)[number];

export const LOG_ERROR_TYPE_LABELS: Record<LogErrorType, string> = {
	all: "All logs",
	any: "Has Error",
	client_error: "Client Errors",
	gateway_error: "Gateway Errors",
	upstream_error: "Upstream Errors",
};

export function isLogErrorType(value: string): value is LogErrorType {
	return (LOG_ERROR_TYPES as readonly string[]).includes(value);
}
