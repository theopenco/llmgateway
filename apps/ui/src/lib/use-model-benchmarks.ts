"use client";

import { useApi } from "@/lib/fetch-client";

// Below this many requests in the window, throughput/uptime/error rates are too
// noisy to be statistically meaningful, so we hide them rather than mislead.
export const MIN_SIGNIFICANT_REQUESTS = 1000;

export function useModelBenchmarks(modelId: string) {
	const api = useApi();

	return api.useQuery(
		"get",
		"/internal/models/{modelId}/benchmarks",
		{ params: { path: { modelId } } },
		{ staleTime: 5 * 60 * 1000 },
	);
}
