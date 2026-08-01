// Derived provider metrics (uptime %, latency averages, throughput) are only
// statistically meaningful once a provider has served a reasonable number of
// requests in the window. Below this threshold surfaces hide the numbers
// instead of showing misleading small-sample averages.
export const MIN_REQUESTS_FOR_STATS = 1000;

// TTFT is averaged over streamed requests only — non-streaming requests never
// record a first-token time — so it needs its own, additional sample gate. A
// provider can serve 5k requests with only a handful streamed, which would sail
// past MIN_REQUESTS_FOR_STATS while resting on a 3-sample average.
//
// The bar is lower than MIN_REQUESTS_FOR_STATS because it guards a different
// kind of statistic: uptime needs many samples to tell 99.9% from 99%, whereas
// the mean of a latency distribution stabilises after far fewer. Reusing 1000
// here would hide well-sampled TTFT from any provider whose traffic is mostly
// non-streaming.
export const MIN_TTFT_SAMPLES_FOR_STATS = 100;

export function formatCompact(n: number): string {
	if (n >= 1_000_000_000_000) {
		return `${(n / 1_000_000_000_000).toFixed(1)}T`;
	}
	if (n >= 1_000_000_000) {
		return `${(n / 1_000_000_000).toFixed(1)}B`;
	}
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(1)}M`;
	}
	if (n >= 1_000) {
		return `${(n / 1_000).toFixed(1)}k`;
	}
	return n.toLocaleString();
}

export function hasEnoughRequestsForStats(logsCount: number): boolean {
	return logsCount > MIN_REQUESTS_FOR_STATS;
}

export function hasEnoughTtftSamplesForStats(
	timeToFirstTokenCount: number,
): boolean {
	return timeToFirstTokenCount > MIN_TTFT_SAMPLES_FOR_STATS;
}

export interface ProviderWindowStats {
	logsCount: number;
	uptime: number | null;
	avgTimeToFirstToken: number | null;
	throughput: number | null;
}

export function gateProviderStats(
	stats: ProviderWindowStats & { timeToFirstTokenCount: number },
): ProviderWindowStats {
	const enoughRequests = hasEnoughRequestsForStats(stats.logsCount);
	return {
		logsCount: stats.logsCount,
		// Every stat hides below the request threshold, so surfaces can show one
		// consistent "stats hidden until N requests" state; TTFT additionally
		// gates on its own streamed-sample count.
		uptime: enoughRequests ? stats.uptime : null,
		throughput: enoughRequests ? stats.throughput : null,
		avgTimeToFirstToken:
			enoughRequests &&
			hasEnoughTtftSamplesForStats(stats.timeToFirstTokenCount)
				? stats.avgTimeToFirstToken
				: null,
	};
}
