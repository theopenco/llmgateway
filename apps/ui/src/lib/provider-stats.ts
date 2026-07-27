// Derived provider metrics (uptime %, latency averages, throughput) are only
// statistically meaningful once a provider has served a reasonable number of
// requests in the window. Below this threshold surfaces hide the numbers
// instead of showing misleading small-sample averages.
export const MIN_REQUESTS_FOR_STATS = 1000;

export function hasEnoughRequestsForStats(logsCount: number): boolean {
	return logsCount > MIN_REQUESTS_FOR_STATS;
}

export interface ProviderWindowStats {
	logsCount: number;
	uptime: number | null;
	avgTimeToFirstToken: number | null;
	throughput: number | null;
}

export function gateProviderStats(
	stats: ProviderWindowStats,
): ProviderWindowStats {
	if (hasEnoughRequestsForStats(stats.logsCount)) {
		return stats;
	}
	return {
		logsCount: stats.logsCount,
		uptime: null,
		avgTimeToFirstToken: null,
		throughput: null,
	};
}
