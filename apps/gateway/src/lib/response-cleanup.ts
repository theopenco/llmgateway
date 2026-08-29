import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";
import type { ServerResponse } from "node:http";

/**
 * Runs `next()` and invokes `cleanup` exactly once when the response settles.
 *
 * Prefers the Node adapter's raw ServerResponse 'close' event: it always fires
 * (normal completion, stream end, or client disconnect), so it is leak-proof
 * and covers long-lived streaming responses for their full duration — a
 * middleware's `await next()` returns as soon as the streamed Response object
 * is produced, long before the stream finishes. Falls back to a `finally`
 * cleanup when the raw response is unavailable (e.g. internal `app.request()`
 * dispatches and tests).
 */
export async function runWithResponseCleanup(
	c: Context<ServerTypes>,
	next: () => Promise<void>,
	cleanup: () => void,
): Promise<void> {
	let done = false;
	const runCleanup = () => {
		if (done) {
			return;
		}
		done = true;
		cleanup();
	};

	const outgoing = (c.env as { outgoing?: ServerResponse } | undefined)
		?.outgoing;

	if (outgoing) {
		outgoing.once("close", runCleanup);
		return await next();
	}

	try {
		await next();
	} finally {
		runCleanup();
	}
}
