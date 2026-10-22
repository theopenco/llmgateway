let shouldStop = false;
let stopAbortController = new AbortController();

function initStopSignal(): void {
	stopAbortController = new AbortController();
}

initStopSignal();

export function resetShutdown(): void {
	shouldStop = false;
	initStopSignal();
}

export function isStopRequested(): boolean {
	return shouldStop;
}

export function requestStop(): void {
	if (shouldStop) {
		return;
	}
	shouldStop = true;
	stopAbortController.abort();
}

export function getStopSignal(): AbortSignal {
	return stopAbortController.signal;
}

// Do not Promise.race this against a promise that only settles on shutdown.
// The race leaves a reaction on that promise after the timer wins, and the
// reaction stays until process exit. Idle loops sleep here constantly (the
// log queue is four loops at 250ms), so the retained reactions grow the heap
// until V8 OOMs. Subscribe to the abort signal and remove the listener when
// the timer wins instead.
export async function interruptibleSleep(ms: number): Promise<void> {
	if (shouldStop || ms <= 0) {
		return;
	}
	const signal = stopAbortController.signal;
	await new Promise<void>((resolve) => {
		let settled = false;
		const timer = setTimeout(finish, ms);
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
