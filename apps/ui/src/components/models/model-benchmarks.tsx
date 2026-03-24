"use client";

import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertTriangle,
	Clock,
	Code,
	ExternalLink,
	MessageSquare,
	Server,
	Trophy,
} from "lucide-react";

import { Badge } from "@/lib/components/badge";
import { useAppConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared/components";

interface ProviderBenchmark {
	providerId: string;
	providerName: string;
	logsCount: number;
	errorsCount: number;
	clientErrorsCount: number;
	gatewayErrorsCount: number;
	upstreamErrorsCount: number;
	cachedCount: number;
	avgTimeToFirstToken: number | null;
	errorRate: number;
}

interface ArenaScore {
	rank: number;
	score: number;
	matchedName: string;
}

interface ArenaBenchmark {
	text: ArenaScore | null;
	code: ArenaScore | null;
	source: string;
	fetchedAt: string;
}

interface BenchmarkData {
	modelId: string;
	providers: ProviderBenchmark[];
	arena: ArenaBenchmark;
}

export function ModelBenchmarks({ modelId }: { modelId: string }) {
	const config = useAppConfig();

	const { data, isLoading } = useQuery<BenchmarkData>({
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

	const providers = data?.providers ?? [];
	const arena = data?.arena;
	const hasProviderData = providers.some((p) => p.logsCount > 0);
	const hasArenaData = arena?.text !== null || arena?.code !== null;

	if (isLoading) {
		return (
			<div className="rounded-lg border border-border p-6">
				<div className="h-6 w-48 animate-pulse rounded bg-muted mb-4" />
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<div key={i} className="h-16 animate-pulse rounded bg-muted" />
					))}
				</div>
			</div>
		);
	}

	if (!hasProviderData && !hasArenaData) {
		return null;
	}

	const sorted = [...providers]
		.filter((p) => p.logsCount > 0)
		.sort((a, b) => {
			if (a.avgTimeToFirstToken === null && b.avgTimeToFirstToken === null) {
				return b.logsCount - a.logsCount;
			}
			if (a.avgTimeToFirstToken === null) {
				return 1;
			}
			if (b.avgTimeToFirstToken === null) {
				return -1;
			}
			return a.avgTimeToFirstToken - b.avgTimeToFirstToken;
		});

	const bestTtft =
		sorted.length > 0
			? Math.min(
					...sorted
						.filter((p) => p.avgTimeToFirstToken !== null)
						.map((p) => p.avgTimeToFirstToken!),
				)
			: null;

	return (
		<div className="space-y-8">
			{/* Arena Benchmarks */}
			{hasArenaData && (
				<div>
					<div className="flex items-center gap-2 mb-4">
						<Trophy className="h-5 w-5 text-muted-foreground" />
						<h2 className="text-xl md:text-2xl font-semibold">
							Quality Benchmarks
						</h2>
					</div>
					<p className="text-sm text-muted-foreground mb-4">
						Crowdsourced quality ratings from{" "}
						<a
							href={arena?.source ?? "https://arena.ai/leaderboard"}
							target="_blank"
							rel="noopener noreferrer"
							className="underline hover:text-foreground inline-flex items-center gap-1"
						>
							Chatbot Arena
							<ExternalLink className="h-3 w-3" />
						</a>
						. Higher ELO score = better quality. Updated{" "}
						{arena?.fetchedAt ?? "recently"}.
					</p>

					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{arena?.text && (
							<div className="rounded-lg border border-border p-4">
								<div className="flex items-center gap-2 mb-3">
									<MessageSquare className="h-4 w-4 text-blue-500" />
									<span className="text-sm font-medium">Overall (Text)</span>
								</div>
								<div className="flex items-baseline gap-3">
									<span className="text-3xl font-bold tabular-nums">
										{arena.text.score}
									</span>
									<span className="text-sm text-muted-foreground">ELO</span>
								</div>
								<div className="mt-2 flex items-center gap-2">
									<Badge
										variant="outline"
										className={cn(
											"text-xs",
											arena.text.rank <= 10
												? "text-amber-600 border-amber-500/50"
												: arena.text.rank <= 30
													? "text-blue-600 border-blue-500/50"
													: "",
										)}
									>
										#{arena.text.rank}
									</Badge>
									<span className="text-xs text-muted-foreground truncate">
										{arena.text.matchedName}
									</span>
								</div>
							</div>
						)}
						{arena?.code && (
							<div className="rounded-lg border border-border p-4">
								<div className="flex items-center gap-2 mb-3">
									<Code className="h-4 w-4 text-purple-500" />
									<span className="text-sm font-medium">Coding</span>
								</div>
								<div className="flex items-baseline gap-3">
									<span className="text-3xl font-bold tabular-nums">
										{arena.code.score}
									</span>
									<span className="text-sm text-muted-foreground">ELO</span>
								</div>
								<div className="mt-2 flex items-center gap-2">
									<Badge
										variant="outline"
										className={cn(
											"text-xs",
											arena.code.rank <= 10
												? "text-amber-600 border-amber-500/50"
												: arena.code.rank <= 30
													? "text-blue-600 border-blue-500/50"
													: "",
										)}
									>
										#{arena.code.rank}
									</Badge>
									<span className="text-xs text-muted-foreground truncate">
										{arena.code.matchedName}
									</span>
								</div>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Provider Performance Benchmarks */}
			{sorted.length > 0 && (
				<div>
					<div className="flex items-center gap-2 mb-4">
						<Activity className="h-5 w-5 text-muted-foreground" />
						<h2 className="text-xl md:text-2xl font-semibold">
							Provider Performance
						</h2>
					</div>
					<p className="text-sm text-muted-foreground mb-4">
						Real latency and error data from LLM Gateway. Lower TTFT (time to
						first token) is better.
					</p>

					<div className="grid gap-3">
						{sorted.map((provider) => {
							const ProviderIcon = getProviderIcon(provider.providerId);
							const isBestTtft =
								bestTtft !== null &&
								provider.avgTimeToFirstToken !== null &&
								provider.avgTimeToFirstToken === bestTtft;

							return (
								<div
									key={provider.providerId}
									className={cn(
										"rounded-lg border p-4 transition-colors",
										isBestTtft
											? "border-green-500/50 bg-green-50/50 dark:bg-green-950/20"
											: "border-border",
									)}
								>
									<div className="flex items-center justify-between gap-4 flex-wrap">
										<div className="flex items-center gap-3 min-w-0">
											{ProviderIcon ? (
												<ProviderIcon className="h-5 w-5 shrink-0" />
											) : (
												<Server className="h-5 w-5 shrink-0 text-muted-foreground" />
											)}
											<div className="min-w-0">
												<div className="flex items-center gap-2">
													<span className="font-medium truncate">
														{provider.providerName}
													</span>
													{isBestTtft && (
														<Badge
															variant="outline"
															className="text-green-600 border-green-500/50 text-xs"
														>
															Fastest
														</Badge>
													)}
												</div>
												<span className="text-xs text-muted-foreground">
													{provider.logsCount.toLocaleString()} requests
												</span>
											</div>
										</div>

										<div className="flex items-center gap-6 text-sm">
											<div className="text-center">
												<div className="flex items-center gap-1 text-muted-foreground mb-0.5">
													<Clock className="h-3 w-3" />
													<span className="text-xs">TTFT</span>
												</div>
												<span
													className={cn(
														"font-mono font-medium",
														provider.avgTimeToFirstToken !== null
															? isBestTtft
																? "text-green-600"
																: ""
															: "text-muted-foreground",
													)}
												>
													{provider.avgTimeToFirstToken !== null
														? `${Math.round(provider.avgTimeToFirstToken)}ms`
														: "\u2014"}
												</span>
											</div>

											<div className="text-center">
												<div className="flex items-center gap-1 text-muted-foreground mb-0.5">
													<AlertTriangle className="h-3 w-3" />
													<span className="text-xs">Errors</span>
												</div>
												<span
													className={cn(
														"font-mono font-medium",
														provider.errorRate > 5
															? "text-red-500"
															: provider.errorRate > 1
																? "text-amber-500"
																: "text-green-600",
													)}
												>
													{provider.errorRate}%
												</span>
											</div>

											{(provider.clientErrorsCount > 0 ||
												provider.gatewayErrorsCount > 0 ||
												provider.upstreamErrorsCount > 0) && (
												<div className="text-center hidden sm:block">
													<div className="text-xs text-muted-foreground mb-0.5">
														Breakdown
													</div>
													<div className="flex gap-2 text-xs font-mono">
														{provider.clientErrorsCount > 0 && (
															<span title="Client errors">
																C:{provider.clientErrorsCount}
															</span>
														)}
														{provider.gatewayErrorsCount > 0 && (
															<span title="Gateway errors">
																G:{provider.gatewayErrorsCount}
															</span>
														)}
														{provider.upstreamErrorsCount > 0 && (
															<span title="Upstream errors">
																U:{provider.upstreamErrorsCount}
															</span>
														)}
													</div>
												</div>
											)}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
