/**
 * Turns whatever the API answered with into a message worth showing an admin.
 *
 * Reaching the fallback means the dialog says "Failed to X" and the admin
 * learns nothing about why, so every envelope the API can actually produce is
 * unwrapped here:
 *
 * - `{ error: true, status, message }` — the global HTTPException handler.
 * - `{ success: false, error: { issues, name: "ZodError" } }` — the
 *   zod-openapi request validator, which never sets a top-level `message`.
 * - a bare string or a non-JSON body — proxies, gateways and infra errors.
 */

const MAX_UNWRAP_DEPTH = 4;

/** Long enough for a provider's rejection, short enough to stay one line-ish. */
const MAX_MESSAGE_LENGTH = 400;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * A non-JSON body is usually a proxy's HTML error page, which is worse than
 * the status line it would replace. Keep plain text only, and truncate it —
 * this ends up inside a dialog, not a log.
 */
function usableText(value: string): string | undefined {
	const text = value.trim();
	if (!text || text.startsWith("<")) {
		return undefined;
	}
	return text.length > MAX_MESSAGE_LENGTH
		? `${text.slice(0, MAX_MESSAGE_LENGTH)}…`
		: text;
}

function fromZodIssues(issues: unknown): string | undefined {
	if (!Array.isArray(issues)) {
		return undefined;
	}
	const described = issues.flatMap((issue) => {
		if (!isRecord(issue) || typeof issue.message !== "string") {
			return [];
		}
		const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
		return [path ? `${path}: ${issue.message}` : issue.message];
	});
	return described.length > 0 ? described.join("; ") : undefined;
}

function extract(value: unknown, depth = 0): string | undefined {
	if (depth > MAX_UNWRAP_DEPTH) {
		return undefined;
	}
	if (typeof value === "string") {
		return usableText(value);
	}
	if (Array.isArray(value)) {
		return fromZodIssues(value);
	}
	if (!isRecord(value)) {
		return undefined;
	}
	if (typeof value.message === "string") {
		const message = usableText(value.message);
		if (message) {
			return message;
		}
	}
	return (
		fromZodIssues(value.issues) ??
		extract(value.error, depth + 1) ??
		extract(value.details, depth + 1)
	);
}

/**
 * @param error the `error` field openapi-fetch returns for a non-2xx response
 * @param fallback wording used when the body carries no reason at all
 * @param response the raw response, so the status can at least be reported
 */
export function apiErrorMessage(
	error: unknown,
	fallback: string,
	response?: Response,
): string {
	const message = extract(error);
	if (message) {
		return message;
	}
	return response ? `${fallback} (HTTP ${response.status})` : fallback;
}

/**
 * Reason for a request that never produced a response — the API was
 * unreachable, the connection dropped, or a long provider probe was aborted.
 * Server actions replace an uncaught throw with an opaque client-side error,
 * so these have to be caught and reported rather than left to propagate.
 */
export function thrownErrorMessage(cause: unknown, fallback: string): string {
	const message =
		cause instanceof Error ? usableText(cause.message) : extract(cause);
	if (!message) {
		return fallback;
	}
	// `fetch` collapses connectivity failures into a bare "fetch failed"; the
	// cause it attaches (ECONNREFUSED, ENOTFOUND, …) is the useful part.
	const detail =
		cause instanceof Error && cause.cause instanceof Error
			? cause.cause.message.trim()
			: undefined;
	return detail && detail !== message ? `${message}: ${detail}` : message;
}
