/**
 * Await an upstream body read (res.text()/res.json()) but settle immediately
 * when the client disconnects, instead of relying on the fetch AbortSignal to
 * propagate into undici's in-flight body machinery.
 *
 * The abort chain for a body read is long: client socket close -> request
 * signal abort event -> AbortController.abort() -> undici erroring the body
 * stream. The last hop is timing-sensitive: a late abort can be missed
 * entirely (the read then blocks until the fetch timeout fires tens of
 * seconds later) or surface as a generic "terminated" TypeError rather than
 * an AbortError. Racing the read against the client signal directly
 * guarantees a prompt AbortError so a disconnect is always recorded as
 * canceled.
 *
 * When `upstreamController` is undefined (the provider does not support
 * cancellation), the read is returned unchanged: the gateway deliberately
 * finishes reading the upstream response so it can be logged and billed.
 *
 * Aborting `upstreamController` here may overlap a caller's own client-abort
 * listener aborting the same controller; the double abort is intentional
 * (AbortController.abort() is idempotent) so the helper stays safe to use
 * without any external listener wiring.
 */
export function raceClientAbort<T>(
	bodyPromise: Promise<T>,
	clientSignal: AbortSignal,
	upstreamController: AbortController | undefined,
): Promise<T> {
	if (!upstreamController) {
		return bodyPromise;
	}

	let removeListener = () => {};
	const clientAborted = new Promise<never>((_, reject) => {
		const onClientAbort = () => {
			// Tear down the upstream connection too: the losing body read stays
			// pending otherwise and would hold the socket until the fetch timeout.
			upstreamController.abort();
			reject(new DOMException("This operation was aborted", "AbortError"));
		};

		if (clientSignal.aborted) {
			onClientAbort();
			return;
		}
		clientSignal.addEventListener("abort", onClientAbort, { once: true });
		removeListener = () =>
			clientSignal.removeEventListener("abort", onClientAbort);
	});

	// Promise.race keeps handlers attached to the body promise even when the
	// abort wins, so its eventual rejection (e.g. the upstream teardown
	// triggered by upstreamController.abort()) never surfaces as an unhandled
	// rejection.
	return Promise.race([bodyPromise, clientAborted]).finally(removeListener);
}
