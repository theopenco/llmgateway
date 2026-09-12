import type { ZodIssue } from "zod";

/**
 * Metadata-only view of Zod issues for application logs: the failing path and
 * code, plus the type names of an `invalid_type` issue. `message`, `received`,
 * `keys` and nested union issues can echo the rejected request body, so they
 * never reach the log.
 */
export function summarizeZodIssues(issues: ZodIssue[]) {
	return issues.map((issue) => ({
		code: issue.code,
		path: issue.path.join("."),
		...(issue.code === "invalid_type" && {
			expected: issue.expected,
			received: issue.received,
		}),
	}));
}
