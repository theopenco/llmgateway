"use client";

import { useQuery } from "@tanstack/react-query";

import { useAppConfig } from "@/lib/config";

export interface ProviderBenchmark {
	providerId: string;
	providerName: string;
	logsCount: number;
	errorsCount: number;
	cachedCount: number;
	avgTimeToFirstToken: number | null;
	tokensPerSecond: number | null;
	errorRate: number;
	uptime: number | null;
	windowHours: number;
}

export interface ArenaScore {
	rank: number;
	score: number;
	matchedName: string;
}

export interface ArenaBenchmark {
	text: ArenaScore | null;
	code: ArenaScore | null;
	source: string;
	fetchedAt: string;
}

export interface BenchmarkData {
	modelId: string;
	providers: ProviderBenchmark[];
	arena: ArenaBenchmark;
}

// Below this many requests in the window, throughput/uptime/error rates are too
// noisy to be statistically meaningful, so we hide them rather than mislead.
export const MIN_SIGNIFICANT_REQUESTS = 1000;

export function useModelBenchmarks(modelId: string) {
	const config = useAppConfig();

	return useQuery<BenchmarkData>({
		queryKey: ["model-benchmarks", modelId],
		queryFn: async () => {
			const response = await fetch(
				`${config.apiUrl}/internal/models/${encodeURIComponent(modelId)}/benchmarks`,
			);
			if (!response.ok) {
				throw new Error("Failed to fetch benchmarks");
			}
			return await response.json();
		},
		staleTime: 5 * 60 * 1000,
	});
}
