/**
 * TTFB hedging for streaming upstream requests.
 *
 * Cold-path stalls (DNS retries, connection setup, a slow edge) show up as a
 * multi-second gap between issuing the upstream request and receiving its
 * response headers, while the median request produces headers well under a
 * second. When the primary request has produced no headers after `delayMs`,
 * a duplicate request races it and whichever produces headers first is
 * served; the loser is aborted immediately. A hedge therefore only fires on
 * the slow tail (with the default delay, well past the p95 of upstream
 * header latency), and the aborted loser costs at most the request's input
 * tokens plus the first moments of generation.
 *
 * Hedging fires on response HEADERS, not the first token: for streaming
 * completions the interesting stall — connection setup — sits entirely
 * before the headers, and a headers race never duplicates a full generation
 * the way racing a non-streaming response body would. For that reason this
 * helper must only be used for streaming upstream requests.
 */

/**
 * Hedge delay in milliseconds; 0 (the default) disables hedging, making it
 * an explicit deployment opt-in — a hedge duplicates upstream spend for the
 * requests it fires on, so it must never switch itself on in environments
 * that didn't ask for it (tests, self-hosted installs, local dev). Not
 * routing-config driven: the threshold reflects gateway-to-provider
 * infrastructure latency, not per-project preferences.
 */
export function getUpstreamHedgeDelayMs(): number {
	const value = Number(process.env.UPSTREAM_HEDGE_DELAY_MS);
	if (Number.isFinite(value) && value >= 0) {
		return value;
	}
	return 0;
}

export interface HedgedFetchOptions {
	/**
	 * Combined timeout/cancellation signal for the whole attempt; aborting it
	 * aborts both branches.
	 */
	signal: AbortSignal;
	/** Delay before the hedge is issued; <= 0 behaves as a plain fetch. */
	delayMs: number;
	/** Invoked when the hedge branch is actually issued. */
	onHedge?: () => void;
	/** Invoked with the branch whose response was served. */
	onWinner?: (winner: "primary" | "hedge") => void;
}

interface BranchResult {
	branch: "primary" | "hedge";
	res: Response;
}

/**
 * Resolves with the first branch to FULFIL; a single rejection only removes
 * that branch from the race. Rejects with the primary's error only when every
 * branch has rejected.
 */
function firstFulfilled(
	branches: { branch: "primary" | "hedge"; promise: Promise<Response> }[],
): Promise<BranchResult> {
	return new Promise((resolve, reject) => {
		let rejections = 0;
		let primaryError: unknown;
		for (const { branch, promise } of branches) {
			promise.then(
				(res) => resolve({ branch, res }),
				(error: unknown) => {
					if (branch === "primary") {
						primaryError = error;
					}
					rejections++;
					if (rejections === branches.length) {
						reject(
							primaryError instanceof Error
								? primaryError
								: new Error(String(primaryError)),
						);
					}
				},
			);
		}
	});
}

/** Abort the losing branch and drain its response if it already fulfilled. */
function discardLoser(
	promise: Promise<Response>,
	controller: AbortController,
): void {
	controller.abort();
	promise
		.then((res) => res.body?.cancel())
		.catch(() => {
			// Losing branch rejections (typically our own abort) are expected.
		});
}

export async function hedgedFetch(
	url: string,
	init: RequestInit,
	{ signal, delayMs, onHedge, onWinner }: HedgedFetchOptions,
): Promise<Response> {
	if (delayMs <= 0) {
		return await fetch(url, { ...init, signal });
	}

	const primaryController = new AbortController();
	const primary = fetch(url, {
		...init,
		signal: AbortSignal.any([signal, primaryController.signal]),
	});

	let timer: NodeJS.Timeout | undefined;
	const hedgeTrigger = new Promise<"hedge">((resolve) => {
		timer = setTimeout(() => resolve("hedge"), delayMs);
	});

	let raced: BranchResult | "hedge";
	try {
		raced = await Promise.race([
			primary.then((res): BranchResult => ({ branch: "primary", res })),
			hedgeTrigger,
		]);
	} catch (error) {
		// The primary rejected before the hedge fired; nothing else is in
		// flight, so behave exactly like a plain fetch failure.
		clearTimeout(timer);
		throw error;
	}
	clearTimeout(timer);

	if (raced !== "hedge") {
		onWinner?.("primary");
		return raced.res;
	}

	onHedge?.();
	const hedgeController = new AbortController();
	const hedge = fetch(url, {
		...init,
		signal: AbortSignal.any([signal, hedgeController.signal]),
	});

	const winner = await firstFulfilled([
		{ branch: "primary", promise: primary },
		{ branch: "hedge", promise: hedge },
	]);

	if (winner.branch === "primary") {
		discardLoser(hedge, hedgeController);
	} else {
		discardLoser(primary, primaryController);
	}
	onWinner?.(winner.branch);
	return winner.res;
}
