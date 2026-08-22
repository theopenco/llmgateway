import { streamSSE as honoStreamSSE } from "hono/streaming";

/**
 * Registry of request work that must finish before shutdown closes the
 * database pool and Redis connections.
 *
 * A streaming handler keeps running after its HTTP connection is gone (client
 * abort, or the client hanging up right after [DONE]), so server.close()
 * returning does NOT mean the billing/logging tail has finished. Closing the
 * pool at that point fails the tail's cost lookups ("Cannot use a pool after
 * calling end on the pool") and loses the request's log entry.
 */
const pending = new Set<Promise<void>>();

export function trackPendingWork<T>(work: Promise<T>): Promise<T> {
	const entry = work.then(
		() => undefined,
		() => undefined,
	);
	pending.add(entry);
	void entry.then(() => pending.delete(entry));
	return work;
}

export function pendingWorkCount(): number {
	return pending.size;
}

/**
 * Waits until all tracked work settles or the timeout elapses.
 * Returns the number of entries still pending.
 */
export async function waitForPendingWork(timeoutMs: number): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	while (pending.size > 0 && Date.now() < deadline) {
		// Entries never reject (failures are swallowed on registration), and the
		// sleep bounds the wait for work registered after this race started.
		await Promise.race([
			Promise.all([...pending]),
			new Promise((resolve) => setTimeout(resolve, 100)),
		]);
	}
	return pending.size;
}

/**
 * Drop-in replacement for hono/streaming's streamSSE that tracks the stream
 * callback in the pending-work registry for its full duration. Gateway routes
 * must use this instead of importing from hono/streaming directly, or their
 * post-stream billing/logging tail races graceful shutdown.
 */
export const streamSSE: typeof honoStreamSSE = (c, cb, onError) =>
	honoStreamSSE(c, (stream) => trackPendingWork(cb(stream)), onError);
