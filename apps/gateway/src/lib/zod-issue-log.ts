import type { ZodIssue } from "zod";

/**
 * Metadata-only view of Zod issues for application logs: the failing path and
 * code, plus the type names of an `invalid_type` issue. Messages of other
 * codes, `keys` and nested union issues can echo the rejected request body,
 * so they never reach the log.
 */
export function summarizeZodIssues(issues: ZodIssue[]) {
	return issues.map((issue) => ({
		code: issue.code,
		path: issue.path.join("."),
		...(issue.code === "invalid_type" && {
			expected: issue.expected,
			received: receivedTypeFrom(issue.message),
		}),
	}));
}

/**
 * zod 4 attaches `input` to issues only when the parse opts in, but the stock
 * invalid_type message is value-free ("Invalid input: expected array,
 * received string"), so the received type name is recovered from it.
 */
function receivedTypeFrom(message: string): string | undefined {
	return /received (\S+)$/.exec(message)?.[1];
}
