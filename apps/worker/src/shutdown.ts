let shouldStop = false;
let stopSignalPromise: Promise<void> = Promise.resolve();
let resolveStopSignal: () => void = () => {};
let stopAbortController = new AbortController();

function initStopSignal(): void {
	stopSignalPromise = new Promise<void>((resolve) => {
		resolveStopSignal = resolve;
	});
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
	resolveStopSignal();
	stopAbortController.abort();
}

export function getStopSignal(): AbortSignal {
	return stopAbortController.signal;
}

export async function interruptibleSleep(ms: number): Promise<void> {
	if (shouldStop || ms <= 0) {
		return;
	}
	let timer: NodeJS.Timeout | undefined;
	await Promise.race([
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, ms);
		}),
		stopSignalPromise,
	]);
	if (timer !== undefined) {
		clearTimeout(timer);
	}
}
