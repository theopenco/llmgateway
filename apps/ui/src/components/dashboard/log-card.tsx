import { format, formatDistanceToNow } from "date-fns";
import {
	AlertCircle,
	TriangleAlert,
	AudioWaveform,
	Ban,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	Coins,
	Globe,
	Info,
	Package,
	Link as LinkIcon,
	ExternalLink,
	Plug,
	Sparkles,
	TrendingDown,
	Zap,
} from "lucide-react";
import Link from "next/link";
import prettyBytes from "pretty-bytes";
import { useState } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/lib/components/tooltip";

import type { Log } from "@llmgateway/db";

export function LogCard({
	log,
	orgId,
	projectId,
}: {
	log: Partial<Log>;
	orgId?: string;
	projectId?: string;
}) {
	// Determine if retention was enabled based on dataStorageCost
	// If dataStorageCost is 0 or null/undefined, retention was disabled
	const retentionEnabled =
		log.dataStorageCost !== null &&
		log.dataStorageCost !== undefined &&
		Number(log.dataStorageCost) > 0;
	const [isExpanded, setIsExpanded] = useState(false);

	const formattedTime = formatDistanceToNow(new Date(log?.createdAt ?? ""), {
		addSuffix: true,
	});

	const toggleExpand = () => {
		setIsExpanded(!isExpanded);
	};

	// Format duration in ms to a readable format
	const formatDuration = (ms: number) => {
		if (ms < 1000) {
			return `${ms}ms`;
		}
		return `${(ms / 1000).toFixed(2)}s`;
	};

	// Recursively render params object
	const renderParams = (
		obj: Record<string, any>,
		depth = 0,
	): React.ReactNode => {
		return Object.entries(obj).flatMap(([key, value]) => {
			if (value === null || value === undefined) {
				return [];
			}

			// If it's an object, render its children directly without showing the parent key
			if (typeof value === "object" && !Array.isArray(value)) {
				return renderParams(value, depth + 1);
			}

			// Format the key for display
			const formattedKey = key
				.replace(/_/g, " ")
				.replace(/\b\w/g, (l) => l.toUpperCase());

			return [
				<div key={key} className="contents">
					<div className="text-muted-foreground">{formattedKey}</div>
					<div>{Array.isArray(value) ? value.join(", ") : String(value)}</div>
				</div>,
			];
		});
	};

	// Determine status icon and color based on error status or unified finish reason
	let StatusIcon = CheckCircle2;
	let color = "text-green-500";
	let bgColor = "bg-green-100";

	if (log.hasError || log.unifiedFinishReason === "error") {
		StatusIcon = AlertCircle;
		color = "text-red-500";
		bgColor = "bg-red-100";
	} else if (log.unifiedFinishReason === "content_filter") {
		StatusIcon = TriangleAlert;
		color = "text-orange-500";
		bgColor = "bg-orange-100";
	} else if (
		log.unifiedFinishReason !== "completed" &&
		log.unifiedFinishReason !== "tool_calls"
	) {
		StatusIcon = AlertCircle;
		color = "text-yellow-500";
		bgColor = "bg-yellow-100";
	}

	return (
		<div className="rounded-lg border bg-card text-card-foreground shadow-sm max-w-full overflow-hidden">
			<div
				className={`flex items-start gap-4 p-4 ${isExpanded ? "border-b" : ""}`}
			>
				<div className={`mt-0.5 rounded-full p-1.5 ${bgColor}`}>
					<StatusIcon className={`h-5 w-5 ${color}`} />
				</div>
				<div className="flex-1 space-y-1 min-w-0">
					<div className="flex items-start justify-between gap-4">
						<div className="flex items-center gap-2 flex-1 min-w-0">
							<p className="font-medium break-words max-w-none line-clamp-2">
								{log.content ||
									(log.unifiedFinishReason === "tool_calls" && log.toolResults
										? Array.isArray(log.toolResults)
											? `Tool calls: ${log.toolResults.map((tr) => tr.function?.name || "unknown").join(", ")}`
											: "Tool calls executed"
										: "---")}
							</p>
							{!log.content &&
								log.unifiedFinishReason !== "tool_calls" &&
								!log.hasError &&
								!log.canceled &&
								!retentionEnabled && (
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<Info className="h-4 w-4 text-muted-foreground flex-shrink-0" />
											</TooltipTrigger>
											<TooltipContent>
												<p>
													Enable retention in organization policies to store
													response content
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								)}
						</div>
						<Badge
							variant={
								log.hasError
									? "destructive"
									: log.unifiedFinishReason === "content_filter"
										? "destructive"
										: "default"
							}
							className="flex-shrink-0"
						>
							{log.unifiedFinishReason}
						</Badge>
					</div>
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-sm text-muted-foreground">
						<div className="flex items-center gap-1">
							<Package className="h-3.5 w-3.5" />
							<span>{log.usedModel}</span>
						</div>
						<div className="flex items-center gap-1">
							<Zap className="h-3.5 w-3.5" />
							<span>
								{log.cached
									? "Fully cached"
									: log.cachedTokens && Number(log.cachedTokens) > 0
										? "Partially cached"
										: "Not cached"}
							</span>
						</div>
						<div className="flex items-center gap-1">
							<Clock className="h-3.5 w-3.5" />
							<span>
								{log.totalTokens} tokens
								{log.cachedTokens && Number(log.cachedTokens) > 0 && (
									<span className="ml-1">({log.cachedTokens} cached)</span>
								)}
							</span>
						</div>
						<div className="flex items-center gap-1">
							<Clock className="h-3.5 w-3.5" />
							<span>{formatDuration(log.duration ?? 0)}</span>
						</div>
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<div className="flex items-center gap-1">
										<Coins className="h-3.5 w-3.5" />
										<span>
											{log.cost
												? `$${log.cost.toFixed(6)}`
												: log.cached
													? "$0"
													: "$0"}
										</span>
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
						</TooltipProvider>
						{log.discount && log.discount !== 1 && (
							<div className="flex items-center gap-1 text-emerald-600">
								<TrendingDown className="h-3.5 w-3.5" />
								<span>{(log.discount * 100).toFixed(0)}% off</span>
							</div>
						)}
						{log.source && (
							<div className="flex items-center gap-1">
								<LinkIcon className="h-3.5 w-3.5" />
								<span>{log.source}</span>
							</div>
						)}
						{log.plugins && log.plugins.length > 0 && (
							<div className="flex items-center gap-1">
								<Plug className="h-3.5 w-3.5" />
								<span>
									{log.plugins.length} plugin{log.plugins.length > 1 ? "s" : ""}
								</span>
							</div>
						)}
						<span className="ml-auto">{formattedTime}</span>
					</div>
				</div>
				<div className="flex items-center gap-1">
					{orgId && projectId && log.id && (
						<Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
							<Link
								href={`/dashboard/${orgId}/${projectId}/activity/${log.id}`}
								prefetch={false}
							>
								<ExternalLink className="h-4 w-4" />
								<span className="sr-only">View details</span>
							</Link>
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						className="h-8 w-8 p-0"
						onClick={toggleExpand}
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
								<div className="font-mono text-xs break-all">
									{log.projectId}
								</div>
								<div className="text-muted-foreground">API Key</div>
								<div className="font-mono text-xs break-all">
									{log.apiKeyId}
								</div>
								<div className="text-muted-foreground">Requested Model</div>
								<div className="font-mono text-xs break-all">
									{log.requestedModel}
								</div>
								<div className="text-muted-foreground">Used Model</div>
								<div className="font-mono text-xs break-all">
									{log.usedModel}
								</div>
								{log.usedModelMapping && (
									<>
										<div className="text-muted-foreground">
											Used Model Provider Mapping
										</div>
										<div>{log.usedModelMapping}</div>
									</>
								)}
								<div className="text-muted-foreground">Provider</div>
								<div>{log.usedProvider}</div>
							</div>
							{log.routingMetadata && (
								<div className="mt-3">
									<h5 className="text-xs font-medium text-muted-foreground mb-2">
										Routing Info
									</h5>
									<div className="rounded-md border border-dashed p-2 text-xs space-y-1.5 bg-muted/30">
										{log.routingMetadata.selectionReason && (
											<div className="flex justify-between">
												<span className="text-muted-foreground">Selection</span>
												<span className="font-mono">
													{log.routingMetadata.selectionReason}
												</span>
											</div>
										)}
										{log.routingMetadata.availableProviders &&
											log.routingMetadata.availableProviders.length > 0 && (
												<div className="flex justify-between">
													<span className="text-muted-foreground">
														Available
													</span>
													<span className="font-mono">
														{log.routingMetadata.availableProviders.join(", ")}
													</span>
												</div>
											)}
										{log.routingMetadata.providerScores &&
											log.routingMetadata.providerScores.length > 0 && (
												<div className="pt-1 border-t border-dashed">
													<div className="text-muted-foreground mb-1">
														Scores
													</div>
													<div className="space-y-1">
														{log.routingMetadata.providerScores.map((score) => (
															<div
																key={score.providerId}
																className="flex justify-between items-center"
															>
																<span className="font-mono">
																	{score.providerId}
																</span>
																<span className="text-muted-foreground">
																	{score.score.toFixed(2)}
																	{score.uptime !== undefined && (
																		<span className="ml-2">
																			↑{score.uptime?.toFixed(0)}%
																		</span>
																	)}
																	{score.throughput !== undefined && (
																		<span className="ml-2">
																			{score.throughput?.toFixed(0)}t/s
																		</span>
																	)}
																	{score.latency !== undefined && (
																		<span className="ml-2">
																			{score.latency?.toFixed(0)}ms
																		</span>
																	)}
																	{score.price !== undefined && (
																		<span className="ml-2">
																			${score.price.toFixed(6)}
																		</span>
																	)}
																	{score.priority !== undefined &&
																		score.priority !== 1 && (
																			<span className="ml-2">
																				p:{score.priority}
																			</span>
																		)}
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
								<div className="text-muted-foreground">Duration</div>
								<div>{formatDuration(log.duration ?? 0)}</div>
								<div className="text-muted-foreground">Throughput</div>
								<div>
									{log.duration && log.totalTokens
										? `${(Number(log.totalTokens) / (log.duration / 1000)).toFixed(1)}t/s`
										: "-"}
								</div>
								{log.timeToFirstToken && (
									<>
										<div className="text-muted-foreground">
											Time to First Token
										</div>
										<div>{formatDuration(log.timeToFirstToken)}</div>
									</>
								)}
								{log.timeToFirstReasoningToken && (
									<>
										<div className="text-muted-foreground">
											Time to First Reasoning Token
										</div>
										<div>{formatDuration(log.timeToFirstReasoningToken)}</div>
									</>
								)}
								<div className="text-muted-foreground">Response Size</div>
								<div>
									{log.responseSize ? (
										<>
											{prettyBytes(log.responseSize)} ({log.responseSize} bytes)
										</>
									) : (
										"Unknown"
									)}
								</div>
								<div className="text-muted-foreground">Prompt Tokens</div>
								<div>{log.promptTokens}</div>
								<div className="text-muted-foreground">Completion Tokens</div>
								<div>{log.completionTokens}</div>
								<div className="text-muted-foreground">Total Tokens</div>
								<div className="font-medium">{log.totalTokens}</div>
								{log.cachedTokens && Number(log.cachedTokens) > 0 && (
									<>
										<div className="text-muted-foreground">
											Cached Input Tokens
										</div>
										<div className="font-medium">{log.cachedTokens}</div>
									</>
								)}
								{log.reasoningTokens && (
									<>
										<div className="text-muted-foreground">
											Reasoning Tokens
										</div>
										<div>{log.reasoningTokens}</div>
									</>
								)}
								{log.imageInputTokens && Number(log.imageInputTokens) > 0 && (
									<>
										<div className="text-muted-foreground">
											Image Input Tokens
										</div>
										<div>{log.imageInputTokens}</div>
									</>
								)}
								{log.imageOutputTokens && Number(log.imageOutputTokens) > 0 && (
									<>
										<div className="text-muted-foreground">
											Image Output Tokens
										</div>
										<div>{log.imageOutputTokens}</div>
									</>
								)}
								<div className="text-muted-foreground">
									Original Finish Reason
								</div>
								<div>{log.finishReason}</div>
								<div className="text-muted-foreground">
									Unified Finish Reason
								</div>
								<div>{log.unifiedFinishReason}</div>
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
								<div className="text-muted-foreground">Canceled</div>
								<div className="flex items-center gap-1">
									{log.canceled ? (
										<>
											<Ban className="h-3.5 w-3.5 text-amber-500" />
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
							<div className="rounded-md border p-3 space-y-3">
								<div>
									<p className="text-xs text-muted-foreground mb-2">
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
										{!!log.cachedInputCost &&
											Number(log.cachedInputCost) > 0 && (
												<>
													<div>Cached Input Cost</div>
													<div>{`$${Number(log.cachedInputCost).toFixed(8)}`}</div>
												</>
											)}
										<div>Request Cost</div>
										<div>
											{log.requestCost
												? `$${log.requestCost.toFixed(8)}`
												: "$0"}
										</div>
										{!!log.webSearchCost && Number(log.webSearchCost) > 0 && (
											<>
												<div>Native Web Search Cost</div>
												<div>{`$${Number(log.webSearchCost).toFixed(8)}`}</div>
											</>
										)}
										{!!log.imageInputCost && Number(log.imageInputCost) > 0 && (
											<>
												<div>Image Input Cost</div>
												<div>{`$${Number(log.imageInputCost).toFixed(8)}`}</div>
											</>
										)}
										{!!log.imageOutputCost &&
											Number(log.imageOutputCost) > 0 && (
												<>
													<div>Image Output Cost</div>
													<div>{`$${Number(log.imageOutputCost).toFixed(8)}`}</div>
												</>
											)}
										<div>Inference Total</div>
										<div>{log.cost ? `$${log.cost.toFixed(8)}` : "$0"}</div>
										{log.discount && log.discount !== 1 && (
											<>
												<div>Discount Applied</div>
												<div className="text-green-600">
													{(log.discount * 100).toFixed(0)}% off
												</div>
											</>
										)}
										{log.pricingTier && (
											<>
												<div>Pricing Tier</div>
												<div>{log.pricingTier}</div>
											</>
										)}
									</div>
								</div>
								<div className="border-t pt-3">
									<p className="text-xs font-medium mb-2">
										Billed to your organization
									</p>
									<div className="grid grid-cols-2 gap-2 text-sm">
										<div className="text-muted-foreground">Data Storage</div>
										<div className="font-medium">
											{log.dataStorageCost
												? `$${Number(log.dataStorageCost).toFixed(8)}`
												: "$0"}
										</div>
										{log.usedMode === "api-keys" && (
											<>
												<div className="text-muted-foreground">
													API Key Fee (1%)
												</div>
												<div className="font-medium">
													{log.serviceFee
														? `$${Number(log.serviceFee).toFixed(8)}`
														: log.cost
															? `$${(Number(log.cost) * 0.01).toFixed(8)}`
															: "$0"}
												</div>
											</>
										)}
									</div>
								</div>
							</div>
						</div>
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Metadata</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
								<div className="text-muted-foreground">Date</div>
								<div className="font-mono text-xs">
									{format(log.createdAt!, "dd.MM.yyyy HH:mm:ss")}
								</div>
								<div className="text-muted-foreground">Request ID</div>
								<div className="font-mono text-xs break-all">
									{log.requestId}
								</div>
								<div className="text-muted-foreground">Source</div>
								<div className="font-mono text-xs break-all">
									{log.source || "-"}
								</div>
								<div className="text-muted-foreground">Project ID</div>
								<div className="font-mono text-xs break-all">
									{log.projectId}
								</div>
								<div className="text-muted-foreground">Organization ID</div>
								<div className="font-mono text-xs break-all">
									{log.organizationId}
								</div>
								<div className="text-muted-foreground">API Key ID</div>
								<div className="font-mono text-xs break-all">
									{log.apiKeyId}
								</div>
								<div className="text-muted-foreground">Mode</div>
								<div>{log.mode || "?"}</div>
								<div className="text-muted-foreground">Used Mode</div>
								<div>{log.usedMode || "?"}</div>
							</div>
							{log.customHeaders &&
								Object.keys(log.customHeaders).length > 0 && (
									<div className="mt-3">
										<h5 className="text-xs font-medium text-muted-foreground mb-2">
											Custom Headers
										</h5>
										<div className="rounded-md border p-3">
											<div className="grid grid-cols-2 gap-2 text-sm">
												{Object.entries(log.customHeaders).map(
													([key, value]) => (
														<div key={key} className="contents">
															<div className="text-muted-foreground font-mono text-xs">
																{key}
															</div>
															<div className="font-mono text-xs break-words">
																{String(value)}
															</div>
														</div>
													),
												)}
											</div>
										</div>
									</div>
								)}
						</div>
					</div>
					<div className="space-y-2">
						<h4 className="text-sm font-medium">Model Parameters</h4>
						<div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-2 md:grid-cols-4">
							<TooltipProvider>
								<div className="flex items-center justify-between gap-2">
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="text-muted-foreground">Temperature</span>
										</TooltipTrigger>
										<TooltipContent>
											<p className="max-w-xs text-xs">
												Controls randomness: higher values produce more random
												outputs
											</p>
										</TooltipContent>
									</Tooltip>
									<span>{log.temperature}</span>
								</div>
								<div className="flex items-center justify-between gap-2">
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="text-muted-foreground">Max Tokens</span>
										</TooltipTrigger>
										<TooltipContent>
											<p className="max-w-xs text-xs">
												Maximum number of tokens to generate
											</p>
										</TooltipContent>
									</Tooltip>
									<span>{log.maxTokens}</span>
								</div>
								<div className="flex items-center justify-between gap-2">
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="text-muted-foreground">Top P</span>
										</TooltipTrigger>
										<TooltipContent>
											<p className="max-w-xs text-xs">
												Alternative to temperature, controls diversity via
												nucleus sampling
											</p>
										</TooltipContent>
									</Tooltip>
									<span>{log.topP}</span>
								</div>
								<div className="flex items-center justify-between gap-2">
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="text-muted-foreground">
												Frequency Penalty
											</span>
										</TooltipTrigger>
										<TooltipContent>
											<p className="max-w-xs text-xs">
												Decreases the likelihood of repeating the same tokens
											</p>
										</TooltipContent>
									</Tooltip>
									<span>{log.frequencyPenalty}</span>
								</div>
								<div className="flex items-center justify-between gap-2">
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="text-muted-foreground">
												Reasoning Effort
											</span>
										</TooltipTrigger>
										<TooltipContent>
											<p className="max-w-xs text-xs">
												Requested chain-of-thought effort for reasoning-capable
												models
											</p>
										</TooltipContent>
									</Tooltip>
									<span>{log.reasoningEffort || "-"}</span>
								</div>
								{log.reasoningMaxTokens && (
									<div className="flex items-center justify-between gap-2">
										<Tooltip>
											<TooltipTrigger asChild>
												<span className="text-muted-foreground">
													Reasoning Budget
												</span>
											</TooltipTrigger>
											<TooltipContent>
												<p className="max-w-xs text-xs">
													Exact token budget allocated for reasoning (max_tokens
													in reasoning config)
												</p>
											</TooltipContent>
										</Tooltip>
										<span>{log.reasoningMaxTokens.toLocaleString()}</span>
									</div>
								)}
								{log.effort && (
									<div className="flex items-center justify-between gap-2">
										<Tooltip>
											<TooltipTrigger asChild>
												<span className="text-muted-foreground">Effort</span>
											</TooltipTrigger>
											<TooltipContent>
												<p className="max-w-xs text-xs">
													Controls the computational effort for supported models
													(e.g., claude-opus-4-5)
												</p>
											</TooltipContent>
										</Tooltip>
										<span>{log.effort}</span>
									</div>
								)}
								<div className="flex items-center justify-between gap-2">
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="text-muted-foreground">
												Response Format
											</span>
										</TooltipTrigger>
										<TooltipContent>
											<p className="max-w-xs text-xs">
												Requested output format (text, json_object, or
												json_schema)
											</p>
										</TooltipContent>
									</Tooltip>
									<span>
										{log.responseFormat
											? typeof log.responseFormat === "object"
												? (log.responseFormat as any).type || "-"
												: "-"
											: "-"}
									</span>
								</div>
							</TooltipProvider>
						</div>
					</div>
					{log.plugins && log.plugins.length > 0 && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Plugins</h4>
							<div className="rounded-md border p-3 text-sm space-y-3">
								<div className="flex flex-wrap gap-2">
									{log.plugins.map((plugin) => (
										<Badge key={plugin} variant="secondary" className="gap-1">
											<Plug className="h-3 w-3" />
											{plugin}
										</Badge>
									))}
								</div>
								{log.pluginResults && (
									<div className="space-y-2 pt-2 border-t">
										<h5 className="text-xs font-medium text-muted-foreground">
											Plugin Results
										</h5>
										{log.pluginResults.responseHealing && (
											<div className="flex items-center gap-2 text-xs">
												<Sparkles
													className={`h-3.5 w-3.5 ${
														log.pluginResults.responseHealing.healed
															? "text-green-500"
															: "text-muted-foreground"
													}`}
												/>
												<span>
													Response Healing:{" "}
													{log.pluginResults.responseHealing.healed ? (
														<span className="text-green-600 font-medium">
															Applied
															{log.pluginResults.responseHealing
																.healingMethod && (
																<span className="text-muted-foreground font-normal">
																	{" "}
																	(
																	{log.pluginResults.responseHealing.healingMethod
																		.replace(/_/g, " ")
																		.replace(/\b\w/g, (l) => l.toUpperCase())}
																	)
																</span>
															)}
														</span>
													) : (
														<span className="text-muted-foreground">
															Not needed (valid JSON)
														</span>
													)}
												</span>
											</div>
										)}
									</div>
								)}
							</div>
						</div>
					)}
					{log.params && Object.keys(log.params).length > 0 && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Additional Parameters</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
								{renderParams(log.params)}
							</div>
						</div>
					)}
					{(log.tools || log.toolChoice || log.toolResults) && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Tool Information</h4>
							<div className="grid gap-4 md:grid-cols-1">
								{log.tools && (
									<div className="space-y-2">
										<h5 className="text-xs font-medium text-muted-foreground">
											Available Tools
										</h5>
										<div className="rounded-md border p-3">
											<pre className="max-h-40 text-xs overflow-auto whitespace-pre-wrap break-words">
												{JSON.stringify(log.tools, null, 2)}
											</pre>
										</div>
									</div>
								)}
								{log.toolChoice && (
									<div className="space-y-2">
										<h5 className="text-xs font-medium text-muted-foreground">
											Tool Choice
										</h5>
										<div className="rounded-md border p-3">
											<pre className="max-h-40 text-xs overflow-auto whitespace-pre-wrap break-words">
												{JSON.stringify(log.toolChoice, null, 2)}
											</pre>
										</div>
									</div>
								)}
								{log.toolResults && (
									<div className="space-y-2">
										<h5 className="text-xs font-medium text-muted-foreground">
											Tool Calls
										</h5>
										<div className="space-y-2">
											{Array.isArray(log.toolResults) ? (
												log.toolResults
													.filter(
														(tc): tc is NonNullable<typeof tc> =>
															tc !== null && tc !== undefined,
													)
													.map((toolCall, index: number) => (
														<div
															key={index}
															className="rounded-md border p-3 overflow-scroll"
														>
															<div className="grid gap-2 text-xs">
																<div className="flex justify-between">
																	<span className="font-medium">
																		{toolCall.function?.name ||
																			"Unknown Function"}
																	</span>
																	<span className="text-muted-foreground">
																		ID: {toolCall.id || "N/A"}
																	</span>
																</div>
																{toolCall.function?.arguments && (
																	<div className="space-y-1">
																		<div className="text-muted-foreground">
																			Arguments:
																		</div>
																		<pre className="text-xs bg-white dark:bg-gray-900 rounded border p-2 overflow-auto max-h-32 text-wrap">
																			{typeof toolCall.function.arguments ===
																			"string"
																				? toolCall.function.arguments
																				: JSON.stringify(
																						toolCall.function.arguments,
																						null,
																						2,
																					)}
																		</pre>
																	</div>
																)}
															</div>
														</div>
													))
											) : (
												<div className="rounded-md border p-3">
													<pre className="max-h-40 text-xs overflow-auto whitespace-pre-wrap break-words">
														{JSON.stringify(log.toolResults, null, 2)}
													</pre>
												</div>
											)}
										</div>
									</div>
								)}
							</div>
						</div>
					)}
					{!!log.webSearchCost && Number(log.webSearchCost) > 0 && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Builtin Tools</h4>
							<div className="grid gap-4 md:grid-cols-1">
								<div className="space-y-2">
									<h5 className="text-xs font-medium text-muted-foreground">
										Native Web Search
									</h5>
									<div className="rounded-md border p-3">
										<div className="flex items-center gap-2 text-sm">
											<Globe className="h-4 w-4 text-sky-500" />
											<span>Web search was used in this request</span>
											<span className="ml-auto text-muted-foreground">
												Cost: ${Number(log.webSearchCost).toFixed(4)}
											</span>
										</div>
									</div>
								</div>
							</div>
						</div>
					)}
					{log.hasError && !!log.errorDetails && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium text-red-600">
								Error Details
							</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
								<div className="text-red-600">Status Code</div>
								<div className="font-medium">{log.errorDetails.statusCode}</div>
								<div className="text-red-600">Status Text</div>
								<div className="font-medium">{log.errorDetails.statusText}</div>
								<div className="text-red-600 col-span-2">Error Message</div>
								<div className="col-span-2 rounded bg-white text-black p-2 text-xs">
									{log.errorDetails.responseText}
								</div>
							</div>
						</div>
					)}
					<div className="space-y-2">
						<h4 className="text-sm font-medium">Message Context</h4>
						<div className="rounded-md border p-3">
							{log.messages ? (
								<pre className="max-h-60 text-xs overflow-auto whitespace-pre-wrap break-words">
									{JSON.stringify(log.messages, null, 2)}
								</pre>
							) : !retentionEnabled ? (
								<p className="text-sm text-muted-foreground italic">
									Message data not retained. Enable retention in organization
									policies to store request messages.
								</p>
							) : (
								<p className="text-sm text-muted-foreground italic">
									No message data available.
								</p>
							)}
						</div>
						{!!log.responseFormat && (
							<div className="mt-3">
								<h5 className="text-xs font-medium text-muted-foreground mb-2">
									Response Format
								</h5>
								<div className="rounded-md border p-3">
									<pre className="max-h-40 text-xs overflow-auto whitespace-pre-wrap break-words">
										{JSON.stringify(log.responseFormat, null, 2)}
									</pre>
								</div>
							</div>
						)}
					</div>
					{log.reasoningContent && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Reasoning Content</h4>
							<div className="rounded-md border p-3">
								<pre className="max-h-60 text-xs overflow-auto whitespace-pre-wrap break-words">
									{log.reasoningContent}
								</pre>
							</div>
						</div>
					)}
					<div className="space-y-2">
						<h4 className="text-sm font-medium">Response</h4>
						<div className="rounded-md border p-3">
							{log.content ? (
								<pre className="max-h-60 text-xs overflow-auto whitespace-pre-wrap break-words">
									{log.content}
								</pre>
							) : !retentionEnabled ? (
								<p className="text-sm text-muted-foreground italic">
									Response content not retained. Enable retention in
									organization policies to store response data.
								</p>
							) : (
								<p className="text-sm text-muted-foreground italic">
									No response content available.
								</p>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
