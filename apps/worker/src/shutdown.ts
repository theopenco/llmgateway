let shouldStop = false;
let stopAbortController = new AbortController();

/** Replaces the abort controller used to wake in-flight sleeps. */
function initStopSignal(): void {
	stopAbortController = new AbortController();
}

initStopSignal();

/** Clears a requested stop and starts a fresh abort signal. */
export function resetShutdown(): void {
	shouldStop = false;
	initStopSignal();
}

/** Reports whether shutdown has been requested. */
export function isStopRequested(): boolean {
	return shouldStop;
}

/** Requests shutdown and wakes every in-flight sleep. */
export function requestStop(): void {
	if (shouldStop) {
		return;
	}
	shouldStop = true;
	stopAbortController.abort();
}

/** Returns the signal that fires when shutdown is requested. */
export function getStopSignal(): AbortSignal {
	return stopAbortController.signal;
}

/**
 * Waits for `ms` milliseconds, or until shutdown is requested.
 *
 * This must not `Promise.race` a promise that only settles on shutdown. The
 * race leaves a reaction on that promise after the timer wins, and idle loops
 * call this often enough for those reactions to grow the heap until V8 runs
 * out of memory. The abort listener is removed when the timer wins.
 */
export async function interruptibleSleep(ms: number): Promise<void> {
	if (shouldStop || ms <= 0) {
		return;
	}
	const signal = stopAbortController.signal;
	await new Promise<void>((resolve) => {
		let settled = false;
		const timer = setTimeout(finish, ms);
		/** Resolves the sleep once, then drops the timer and abort listener. */
		function finish(): void {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", finish);
			resolve();
		}
		if (signal.aborted) {
			finish();
			return;
		}
		signal.addEventListener("abort", finish, { once: true });
	});
}
