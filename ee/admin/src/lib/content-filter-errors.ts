import type { ContentFilterErrorKind } from "./admin-content-filter";

export const ERROR_KIND_LABELS: Record<ContentFilterErrorKind, string> = {
	upstream_4xx: "Rejected input (4xx)",
	upstream_5xx: "Upstream 5xx",
	timeout: "Timeout",
	network: "Network",
	bad_response: "Bad response",
	unexpected: "Unexpected",
};
