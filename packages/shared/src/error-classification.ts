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

export const INCIDENT_BREAKDOWN_HEADER = "Upstream / Gateway / Other";

export const INCIDENT_BREAKDOWN_DESCRIPTION =
	"Client errors are excluded (not retried, no effect on uptime). Upstream errors count against the provider's uptime, gateway errors are on LLM Gateway's side, and other covers canceled and content-filtered requests.";

/** Non-client errors that are neither upstream nor gateway errors. */
export function otherErrorCount(row: {
	errorCount: number;
	upstreamErrorCount: number;
	gatewayErrorCount: number;
}): number {
	return row.errorCount - row.upstreamErrorCount - row.gatewayErrorCount;
}
