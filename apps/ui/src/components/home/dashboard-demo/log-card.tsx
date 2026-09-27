"use client";

import { format, formatDistance, subSeconds } from "date-fns";
import {
	AlertCircle,
	AudioWaveform,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	Coins,
	Info,
	Link as LinkIcon,
	Package,
	TriangleAlert,
	Zap,
} from "lucide-react";
import { useState } from "react";

import { DEMO_ORG } from "@/components/home/dashboard-demo-data";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/lib/components/tooltip";

import type {
	DemoLog,
	DemoProject,
} from "@/components/home/dashboard-demo-data";

function formatDuration(ms: number) {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	return `${(ms / 1000).toFixed(2)}s`;
}

function Row({ label, children }: { label: string; children: string }) {
	return (
		<>
			<div className="text-muted-foreground">{label}</div>
			<div>{children}</div>
		</>
	);
}

export function DemoLogCard({
	log,
	openedAt,
	project,
	onToggle,
}: {
	log: DemoLog;
	openedAt: number;
	project: DemoProject;
	onToggle: (expanded: boolean) => void;
}) {
	const [isExpanded, setIsExpanded] = useState(false);
	const createdAt = subSeconds(openedAt, log.agoSeconds);
	const totalTokens = log.promptTokens + log.completionTokens;
	const formattedTime = formatDistance(createdAt, openedAt, {
		addSuffix: true,
	});

	let StatusIcon = CheckCircle2;
	let color = "text-green-500";
	let bgColor = "bg-green-100 dark:bg-green-900/30";
	if (log.hasError) {
		StatusIcon = AlertCircle;
		color = "text-red-500";
		bgColor = "bg-red-100 dark:bg-red-900/30";
	} else if (log.unifiedFinishReason === "content_filter") {
		StatusIcon = TriangleAlert;
		color = "text-orange-500";
		bgColor = "bg-orange-100 dark:bg-orange-900/30";
	}

	return (
		<div className="max-w-full overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
			<div
				className={`flex items-start gap-4 p-4 ${isExpanded ? "border-b" : ""}`}
			>
				<div className={`mt-0.5 shrink-0 rounded-full p-1 ${bgColor}`}>
					<StatusIcon className={`h-4 w-4 ${color}`} />
				</div>
				<div className="min-w-0 flex-1 space-y-1">
					<div className="flex items-start justify-between gap-4">
						<div className="flex min-w-0 flex-1 items-center gap-2">
							<p className="line-clamp-2 max-w-none break-words font-medium">
								{log.content ??
									(log.unifiedFinishReason === "tool_calls"
										? "Tool calls: search_repository, read_file"
										: "---")}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-1.5">
							<Badge variant={log.hasError ? "destructive" : "default"}>
								{log.unifiedFinishReason}
							</Badge>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-sm text-muted-foreground">
						<div className="flex items-center gap-1">
							<Package className="h-3.5 w-3.5 shrink-0" />
							<span className="truncate">{log.usedModel || "—"}</span>
						</div>
						<div className="flex items-center gap-1">
							<Zap className="h-3.5 w-3.5 shrink-0" />
							<span>
								{log.cached
									? "Fully cached"
									: log.cachedTokens > 0
										? "Partially cached"
										: "Not cached"}
							</span>
						</div>
						<div className="flex items-center gap-1">
							<Clock className="h-3.5 w-3.5 shrink-0" />
							<span>
								{totalTokens} tokens
								{log.cachedTokens > 0 && (
									<span className="ml-1">({log.cachedTokens} cached)</span>
								)}
							</span>
						</div>
						<div className="flex items-center gap-1">
							<Clock className="h-3.5 w-3.5 shrink-0" />
							<span>{formatDuration(log.duration)}</span>
						</div>
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="flex items-center gap-1">
									<Coins className="h-3.5 w-3.5 shrink-0" />
									<span>{log.cost ? `$${log.cost.toFixed(6)}` : "$0"}</span>
									<Info className="h-3 w-3 text-muted-foreground/50" />
								</div>
							</TooltipTrigger>
							<TooltipContent>
								<p>
									Provider cost
									{log.usedMode === "api-keys" &&
										" — not deducted from your balance"}
								</p>
							</TooltipContent>
						</Tooltip>
						<div className="flex items-center gap-1">
							<LinkIcon className="h-3.5 w-3.5 shrink-0" />
							<span>{log.source}</span>
						</div>
						<span className="ml-auto">{formattedTime}</span>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						className="h-8 w-8 p-0"
						onClick={() => {
							setIsExpanded(!isExpanded);
							onToggle(!isExpanded);
						}}
					>
						{isExpanded ? (
							<ChevronUp className="h-4 w-4" />
						) : (
							<ChevronDown className="h-4 w-4" />
						)}
						<span className="sr-only">Toggle details</span>
					</Button>
				</div>
			</div>

			{isExpanded && (
				<div className="space-y-4 p-4">
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Request Details</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
								<div className="text-muted-foreground">Project ID</div>
								<span className="block break-all font-mono text-xs">
									{project.id}
								</span>
								<div className="text-muted-foreground">API Key</div>
								<span className="block break-all font-mono text-xs">
									{log.apiKeyId}
								</span>
								<div className="text-muted-foreground">Requested Model</div>
								<div className="break-all font-mono text-xs">
									{log.requestedModel}
								</div>
								<div className="text-muted-foreground">Used Model</div>
								<div className="break-all font-mono text-xs">
									{log.usedModel || "—"}
								</div>
								<div className="text-muted-foreground">Provider</div>
								<div>{log.usedProvider}</div>
							</div>
							{log.selectionReason && (
								<div className="mt-3">
									<h5 className="mb-2 text-xs font-medium text-muted-foreground">
										Routing Info
									</h5>
									<div className="space-y-1.5 rounded-md border border-dashed bg-muted/30 p-2 text-xs">
										<div className="flex justify-between">
											<span className="text-muted-foreground">Selection</span>
											<span className="font-mono">{log.selectionReason}</span>
										</div>
										<div className="flex justify-between">
											<span className="text-muted-foreground">
												X-No-Fallback
											</span>
											<span className="font-mono">
												{log.noFallback ? "set (active)" : "unset"}
											</span>
										</div>
										{log.availableProviders &&
											log.availableProviders.length > 0 && (
												<div className="flex justify-between gap-2">
													<span className="text-muted-foreground">
														Available
													</span>
													<span className="text-right font-mono">
														{log.availableProviders.join(", ")}
													</span>
												</div>
											)}
										{log.providerScores && log.providerScores.length > 0 && (
											<div className="border-t border-dashed pt-1">
												<div className="mb-1 text-muted-foreground">Scores</div>
												<div className="space-y-1">
													{log.providerScores.map((score) => (
														<div
															key={score.providerId}
															className="flex items-center justify-between"
														>
															<span className="flex items-center gap-1.5 font-mono">
																{score.providerId}
																{score.failed && (
																	<span className="inline-flex items-center gap-0.5 text-red-500">
																		<AlertCircle className="h-3 w-3" />
																		<span>
																			{score.statusCode}
																			<span className="ml-0.5 text-red-400">
																				{score.errorType}
																			</span>
																		</span>
																	</span>
																)}
															</span>
															<span className="font-mono text-muted-foreground">
																{score.score.toFixed(2)}
																<span className="ml-2">
																	↑{score.uptime.toFixed(0)}%
																</span>
																<span className="ml-2">
																	{score.latency.toFixed(0)}ms
																</span>
																<span className="ml-2">${score.price}</span>
															</span>
														</div>
													))}
												</div>
											</div>
										)}
										{log.routing && log.routing.length > 0 && (
											<div className="border-t border-dashed pt-1">
												<div className="mb-1 text-muted-foreground">
													Request Attempts
												</div>
												<div className="space-y-1">
													{log.routing.map((attempt, index) => (
														<div
															key={`${attempt.provider}-${index}`}
															className={`flex items-center justify-between ${attempt.succeeded ? "text-green-600" : "text-red-500"}`}
														>
															<span className="flex items-center gap-1 font-mono">
																{attempt.succeeded ? (
																	<CheckCircle2 className="h-3 w-3" />
																) : (
																	<AlertCircle className="h-3 w-3" />
																)}
																{attempt.provider}/{attempt.model}
															</span>
															<span>
																{attempt.statusCode}{" "}
																{attempt.succeeded ? "ok" : attempt.errorType}
															</span>
														</div>
													))}
												</div>
											</div>
										)}
									</div>
								</div>
							)}
						</div>
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Response Metrics</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
								<Row label="Duration">{formatDuration(log.duration)}</Row>
								<Row label="Throughput">
									{log.duration && totalTokens
										? `${(totalTokens / (log.duration / 1000)).toFixed(1)}t/s`
										: "-"}
								</Row>
								{log.timeToFirstToken !== null && (
									<Row label="Time to First Token">
										{formatDuration(log.timeToFirstToken)}
									</Row>
								)}
								<Row label="Prompt Tokens">{String(log.promptTokens)}</Row>
								<Row label="Completion Tokens">
									{String(log.completionTokens)}
								</Row>
								<div className="text-muted-foreground">Total Tokens</div>
								<div className="font-medium">{totalTokens}</div>
								{log.cachedTokens > 0 && (
									<>
										<div className="text-muted-foreground">
											Cached Input Tokens
										</div>
										<div className="font-medium">{log.cachedTokens}</div>
									</>
								)}
								<Row label="Original Finish Reason">{log.finishReason}</Row>
								<Row label="Unified Finish Reason">
									{log.unifiedFinishReason}
								</Row>
								{log.errorCategory && (
									<Row label="Error Category">{log.errorCategory}</Row>
								)}
								<div className="text-muted-foreground">Streamed</div>
								<div className="flex items-center gap-1">
									{log.streamed ? (
										<>
											<AudioWaveform className="h-3.5 w-3.5 text-green-500" />
											<span>Yes</span>
										</>
									) : (
										<span>No</span>
									)}
								</div>
								<div className="text-muted-foreground">Cached</div>
								<div className="flex items-center gap-1">
									{log.cached ? (
										<>
											<Zap className="h-3.5 w-3.5 text-blue-500" />
											<span>Yes</span>
										</>
									) : (
										<span>No</span>
									)}
								</div>
							</div>
						</div>
					</div>

					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-3">
							<h4 className="text-sm font-medium">Cost Information</h4>
							<div className="space-y-3 rounded-md border p-3">
								<div>
									<p className="mb-2 text-xs text-muted-foreground">
										Provider pricing
										{log.usedMode === "api-keys" &&
											" — not deducted from your balance"}
									</p>
									<div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
										<div>Input Cost</div>
										<div>
											{log.inputCost ? `$${log.inputCost.toFixed(8)}` : "$0"}
										</div>
										<div>Output Cost</div>
										<div>
											{log.outputCost ? `$${log.outputCost.toFixed(8)}` : "$0"}
										</div>
										{log.cachedInputCost > 0 && (
											<>
												<div>Cached Input Cost</div>
												<div>{`$${log.cachedInputCost.toFixed(8)}`}</div>
											</>
										)}
										<div>Request Cost</div>
										<div>$0</div>
										<div>Inference Total</div>
										<div>{log.cost ? `$${log.cost.toFixed(8)}` : "$0"}</div>
									</div>
								</div>
								<div className="border-t pt-3">
									<p className="mb-2 text-xs font-medium">
										Billed to your organization
									</p>
									<div className="grid grid-cols-2 gap-2 text-sm">
										<div className="text-muted-foreground">Data Storage</div>
										<div className="font-medium">
											${((totalTokens / 1_000_000) * 0.01).toFixed(8)}
										</div>
									</div>
								</div>
							</div>
						</div>
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Metadata</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
								<div className="text-muted-foreground">Date</div>
								<div className="font-mono text-xs">
									{format(createdAt, "dd.MM.yyyy HH:mm:ss")}
								</div>
								<div className="text-muted-foreground">Source</div>
								<div className="break-all font-mono text-xs">{log.source}</div>
								<div className="text-muted-foreground">Project</div>
								<span className="block break-words">{project.name}</span>
								<div className="text-muted-foreground">Organization</div>
								<span className="block break-words">{DEMO_ORG.name}</span>
								<div className="text-muted-foreground">API Key</div>
								<span className="block break-words">{log.apiKeyName}</span>
								<Row label="API Origin">Chat Completions</Row>
								<Row label="Used Mode">{log.usedMode}</Row>
							</div>
						</div>
					</div>

					{log.hasError && log.errorDetails && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium text-red-600">
								Error Details
							</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-900/30">
								<div className="text-red-600">Status Code</div>
								<div className="font-medium">{log.errorDetails.statusCode}</div>
								<div className="text-red-600">Status Text</div>
								<div className="font-medium">{log.errorDetails.statusText}</div>
								<div className="col-span-2 text-red-600">Error Message</div>
								<div className="col-span-2 break-all rounded bg-white p-2 text-xs text-black dark:bg-gray-900 dark:text-gray-100">
									{log.errorDetails.responseText}
								</div>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
