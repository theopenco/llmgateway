"use client";

import { format, formatDistanceToNow } from "date-fns";
import {
	AlertCircle,
	AudioWaveform,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	Coins,
	Copy,
	Package,
	TrendingDown,
	Zap,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { ProjectLogEntry } from "@/lib/types";

interface RoutingMetadata {
	selectionReason?: string;
	availableProviders?: string[];
	providerScores?: Array<{
		providerId: string;
		score: number;
		uptime?: number;
		throughput?: number;
		latency?: number;
		price?: number;
		priority?: number;
		failed?: boolean;
		status_code?: number;
		error_type?: string;
	}>;
	routing?: Array<{
		provider: string;
		model: string;
		succeeded: boolean;
		status_code?: number;
		error_type?: string;
	}>;
}

function formatDuration(ms: number) {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	return `${(ms / 1000).toFixed(2)}s`;
}

function copyToClipboard(text: string) {
	void navigator.clipboard.writeText(text);
}

export function LogCard({ log }: { log: ProjectLogEntry }) {
	const [isExpanded, setIsExpanded] = useState(false);

	let StatusIcon = CheckCircle2;
	let color = "text-green-500";
	let bgColor = "bg-green-100";

	if (log.hasError || log.unifiedFinishReason === "error") {
		StatusIcon = AlertCircle;
		color = "text-red-500";
		bgColor = "bg-red-100";
	} else if (
		log.unifiedFinishReason !== "completed" &&
		log.unifiedFinishReason !== "tool_calls"
	) {
		StatusIcon = AlertCircle;
		color = "text-yellow-500";
		bgColor = "bg-yellow-100";
	}

	return (
		<div className="rounded-lg border border-border/60 bg-card text-card-foreground shadow-sm overflow-hidden">
			<div
				className={`flex items-start gap-3 p-3 ${isExpanded ? "border-b" : ""}`}
			>
				<div className={`mt-0.5 shrink-0 rounded-full p-1 ${bgColor}`}>
					<StatusIcon className={`h-4 w-4 ${color}`} />
				</div>
				<div className="flex-1 min-w-0 space-y-1">
					<div className="flex items-start justify-between gap-2">
						<p className="text-sm font-medium truncate">
							{log.content ?? "---"}
						</p>
						<div className="flex items-center gap-1.5 shrink-0">
							<Badge
								variant={log.hasError ? "destructive" : "default"}
								className="text-xs"
							>
								{log.unifiedFinishReason ?? "—"}
							</Badge>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
						<div className="flex items-center gap-1">
							<Package className="h-3 w-3" />
							<span>{log.usedModel}</span>
						</div>
						<div className="flex items-center gap-1">
							<Zap className="h-3 w-3" />
							<span>
								{log.cached
									? "Cached"
									: log.cachedTokens && Number(log.cachedTokens) > 0
										? "Partial cache"
										: "Not cached"}
							</span>
						</div>
						<div className="flex items-center gap-1">
							<Clock className="h-3 w-3" />
							<span>{log.totalTokens ?? 0} tokens</span>
						</div>
						<div className="flex items-center gap-1">
							<Clock className="h-3 w-3" />
							<span>{formatDuration(log.duration)}</span>
						</div>
						<div className="flex items-center gap-1">
							<Coins className="h-3 w-3" />
							<span>{log.cost ? `$${log.cost.toFixed(6)}` : "$0"}</span>
						</div>
						{log.discount && log.discount !== 1 && (
							<div className="flex items-center gap-1 text-emerald-600">
								<TrendingDown className="h-3 w-3" />
								<span>{(log.discount * 100).toFixed(0)}% off</span>
							</div>
						)}
						{log.streamed && (
							<div className="flex items-center gap-1">
								<AudioWaveform className="h-3 w-3" />
								<span>Streamed</span>
							</div>
						)}
						{log.source && (
							<span className="text-muted-foreground">{log.source}</span>
						)}
						<span className="ml-auto">
							{formatDistanceToNow(new Date(log.createdAt), {
								addSuffix: true,
							})}
						</span>
					</div>
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="h-8 w-8 shrink-0 p-0"
					onClick={() => setIsExpanded(!isExpanded)}
				>
					{isExpanded ? (
						<ChevronUp className="h-4 w-4" />
					) : (
						<ChevronDown className="h-4 w-4" />
					)}
				</Button>
			</div>

			{isExpanded && (
				<div className="space-y-4 p-4">
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Request Details</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
								<div className="text-muted-foreground">Request ID</div>
								<div className="flex items-center gap-1 font-mono text-xs break-all">
									<span>{log.requestId ?? "—"}</span>
									{log.requestId && (
										<button
											className="text-muted-foreground hover:text-foreground"
											onClick={() => copyToClipboard(log.requestId!)}
										>
											<Copy className="h-3 w-3" />
										</button>
									)}
								</div>
								<div className="text-muted-foreground">Log ID</div>
								<div className="flex items-center gap-1 font-mono text-xs break-all">
									<span>{log.id}</span>
									<button
										className="text-muted-foreground hover:text-foreground"
										onClick={() => copyToClipboard(log.id)}
									>
										<Copy className="h-3 w-3" />
									</button>
								</div>
								<div className="text-muted-foreground">Requested Model</div>
								<div className="font-mono text-xs">
									{log.requestedModel ?? "—"}
								</div>
								<div className="text-muted-foreground">Used Model</div>
								<div className="font-mono text-xs">{log.usedModel}</div>
								<div className="text-muted-foreground">Provider</div>
								<div className="font-mono text-xs">{log.usedProvider}</div>
								{log.usedModelMapping && (
									<>
										<div className="text-muted-foreground">Mapping</div>
										<div className="font-mono text-xs">
											{log.usedModelMapping}
										</div>
									</>
								)}
								<div className="text-muted-foreground">Mode</div>
								<div>{log.usedMode}</div>
								<div className="text-muted-foreground">Date</div>
								<div className="font-mono text-xs">
									{format(new Date(log.createdAt), "dd.MM.yyyy HH:mm:ss")}
								</div>
							</div>

							{log.routingMetadata
								? (() => {
										const rm = log.routingMetadata as RoutingMetadata;
										return (
											<div className="mt-3">
												<h5 className="text-xs font-medium text-muted-foreground mb-2">
													Routing Info
												</h5>
												<div className="rounded-md border border-dashed p-2 text-xs space-y-1.5 bg-muted/30">
													{rm.selectionReason && (
														<div className="flex justify-between">
															<span className="text-muted-foreground">
																Selection
															</span>
															<span className="font-mono">
																{rm.selectionReason}
															</span>
														</div>
													)}
													{rm.availableProviders &&
														rm.availableProviders.length > 0 && (
															<div className="flex justify-between">
																<span className="text-muted-foreground">
																	Available
																</span>
																<span className="font-mono">
																	{rm.availableProviders.join(", ")}
																</span>
															</div>
														)}
													{rm.providerScores &&
														rm.providerScores.length > 0 && (
															<div className="pt-1 border-t border-dashed">
																<div className="text-muted-foreground mb-1">
																	Scores
																</div>
																<div className="space-y-1">
																	{rm.providerScores.map((score) => (
																		<div
																			key={score.providerId}
																			className="flex justify-between items-center"
																		>
																			<span className="font-mono flex items-center gap-1.5">
																				{score.providerId}
																				{score.failed && (
																					<span className="text-red-500">
																						{score.status_code}{" "}
																						{score.error_type}
																					</span>
																				)}
																			</span>
																			<span className="text-muted-foreground">
																				{score.score.toFixed(2)}
																				{score.uptime !== undefined && (
																					<span className="ml-2">
																						↑{score.uptime?.toFixed(0)}%
																					</span>
																				)}
																				{score.latency !== undefined && (
																					<span className="ml-2">
																						{score.latency?.toFixed(0)}
																						ms
																					</span>
																				)}
																			</span>
																		</div>
																	))}
																</div>
															</div>
														)}
													{rm.routing && rm.routing.length > 0 && (
														<div className="pt-1 border-t border-dashed">
															<div className="text-muted-foreground mb-1">
																Request Attempts
															</div>
															<div className="space-y-1">
																{rm.routing.map((attempt, i) => (
																	<div
																		key={`${attempt.provider}-${i}`}
																		className={`flex justify-between items-center ${attempt.succeeded ? "text-green-600" : "text-red-500"}`}
																	>
																		<span className="font-mono flex items-center gap-1">
																			{attempt.succeeded ? (
																				<CheckCircle2 className="h-3 w-3" />
																			) : (
																				<AlertCircle className="h-3 w-3" />
																			)}
																			{attempt.provider}/{attempt.model}
																		</span>
																		<span>
																			{attempt.status_code}{" "}
																			{attempt.succeeded
																				? "ok"
																				: attempt.error_type}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}
												</div>
											</div>
										);
									})()
								: null}
						</div>
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Response Metrics</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
								<div className="text-muted-foreground">Duration</div>
								<div>{formatDuration(log.duration)}</div>
								<div className="text-muted-foreground">Throughput</div>
								<div>
									{log.duration && log.totalTokens
										? `${(Number(log.totalTokens) / (log.duration / 1000)).toFixed(1)}t/s`
										: "—"}
								</div>
								{log.timeToFirstToken !== null && (
									<>
										<div className="text-muted-foreground">TTFT</div>
										<div>{formatDuration(log.timeToFirstToken)}</div>
									</>
								)}
								{log.responseSize !== null && (
									<>
										<div className="text-muted-foreground">Response Size</div>
										<div>{log.responseSize} bytes</div>
									</>
								)}
								<div className="text-muted-foreground">Prompt Tokens</div>
								<div>{log.promptTokens ?? "—"}</div>
								<div className="text-muted-foreground">Completion Tokens</div>
								<div>{log.completionTokens ?? "—"}</div>
								<div className="text-muted-foreground">Total Tokens</div>
								<div className="font-medium">{log.totalTokens ?? "—"}</div>
								{log.reasoningTokens && Number(log.reasoningTokens) > 0 && (
									<>
										<div className="text-muted-foreground">
											Reasoning Tokens
										</div>
										<div>{log.reasoningTokens}</div>
									</>
								)}
								{log.cachedTokens && Number(log.cachedTokens) > 0 && (
									<>
										<div className="text-muted-foreground">Cached Tokens</div>
										<div>{log.cachedTokens}</div>
									</>
								)}
								<div className="text-muted-foreground">Finish Reason</div>
								<div>
									{log.finishReason ?? "—"} → {log.unifiedFinishReason ?? "—"}
								</div>
							</div>

							<h4 className="text-sm font-medium mt-4">Cost Breakdown</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
								<div className="text-muted-foreground">Input Cost</div>
								<div>
									{log.inputCost ? `$${log.inputCost.toFixed(8)}` : "$0"}
								</div>
								<div className="text-muted-foreground">Output Cost</div>
								<div>
									{log.outputCost ? `$${log.outputCost.toFixed(8)}` : "$0"}
								</div>
								{log.cachedInputCost !== null &&
									Number(log.cachedInputCost) > 0 && (
										<>
											<div className="text-muted-foreground">Cached Input</div>
											<div>${Number(log.cachedInputCost).toFixed(8)}</div>
										</>
									)}
								{log.requestCost !== null && Number(log.requestCost) > 0 && (
									<>
										<div className="text-muted-foreground">Request Cost</div>
										<div>${Number(log.requestCost).toFixed(8)}</div>
									</>
								)}
								<div className="text-muted-foreground font-medium">Total</div>
								<div className="font-medium">
									{log.cost ? `$${log.cost.toFixed(8)}` : "$0"}
								</div>
								{log.dataStorageCost !== null &&
									Number(log.dataStorageCost) > 0 && (
										<>
											<div className="text-muted-foreground">Data Storage</div>
											<div>${Number(log.dataStorageCost).toFixed(8)}</div>
										</>
									)}
								{log.discount !== null && log.discount !== 1 && (
									<>
										<div className="text-muted-foreground">Discount</div>
										<div className="text-emerald-600">
											{(log.discount * 100).toFixed(0)}% off
										</div>
									</>
								)}
							</div>
						</div>
					</div>

					{log.errorDetails ? (
						<div className="space-y-2">
							<h4 className="text-sm font-medium text-red-500">
								Error Details
							</h4>
							<pre className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800 overflow-auto max-h-40 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
								{JSON.stringify(
									log.errorDetails as Record<string, unknown>,
									null,
									2,
								)}
							</pre>
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}
