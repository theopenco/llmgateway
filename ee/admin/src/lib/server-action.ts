import { isBrowserNetworkError, thrownErrorMessage } from "./api-error";
import { formatDurationMs } from "./format-duration";

interface ActionResult {
	success: boolean;
	error?: string;
}

/**
 * Why a server action call rejected on the client. The actions in this app
 * already turn API failures into `{ success: false, error }`, so a rejection
 * means the action itself never answered: the connection dropped, a proxy
 * timed out or replied with a non-RSC page, the server crashed while rendering
 * the response, or the page predates a redeploy and its action id is gone.
 */
export function serverActionErrorMessage(
	cause: unknown,
	fallback: string,
	elapsedMs: number,
): string {
	if (isBrowserNetworkError(cause)) {
		return `${fallback}: the admin server did not answer after ${formatDurationMs(elapsedMs)} (browser reported "${cause.message}"). The change may still have been saved; reload to check before retrying.`;
	}
	const message = cause instanceof Error ? cause.message : "";
	if (/server action .* (was )?not found/i.test(message)) {
		return `${fallback}: this page is out of date after a deploy. Reload and try again.`;
	}
	const digest =
		cause instanceof Error && "digest" in cause ? cause.digest : undefined;
	if (typeof digest === "string" && digest) {
		return `${fallback}: the admin server failed while handling the request after ${formatDurationMs(elapsedMs)} (error digest ${digest}). Check the admin app logs for this digest.`;
	}
	const detail = thrownErrorMessage(cause, "");
	return detail
		? `${fallback} after ${formatDurationMs(elapsedMs)}: ${detail}`
		: `${fallback}: no response after ${formatDurationMs(elapsedMs)}.`;
}

/**
 * Calls a server action and never rejects, so a caller's loading state is
 * always cleared and the admin sees why the action failed.
 */
export async function runServerAction(
	action: () => Promise<ActionResult>,
	fallback: string,
): Promise<ActionResult> {
	const startedAt = Date.now();
	try {
		return await action();
	} catch (cause) {
		return {
			success: false,
			error: serverActionErrorMessage(cause, fallback, Date.now() - startedAt),
		};
	}
}
