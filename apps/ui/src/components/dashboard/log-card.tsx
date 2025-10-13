import { format, formatDistanceToNow } from "date-fns";
import {
	AlertCircle,
	AudioWaveform,
	Ban,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	Coins,
	Package,
	Link as LinkIcon,
	Zap,
} from "lucide-react";
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

export function LogCard({ log }: { log: Partial<Log> }) {
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

	// Determine status icon and color based on error status or unified finish reason
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
		<div className="rounded-lg border bg-card text-card-foreground shadow-sm max-w-full overflow-hidden">
			<div
				className={`flex items-start gap-4 p-4 ${isExpanded ? "border-b" : ""}`}
			>
				<div className={`mt-0.5 rounded-full p-1.5 ${bgColor}`}>
					<StatusIcon className={`h-5 w-5 ${color}`} />
				</div>
				<div className="flex-1 space-y-1 min-w-0">
					<div className="flex items-start justify-between gap-4">
						<p className="font-medium break-words max-w-none line-clamp-2">
							{log.content ||
								(log.unifiedFinishReason === "tool_calls" && log.toolResults ? (
									Array.isArray(log.toolResults) ? (
										`Tool calls: ${log.toolResults.map((tr) => tr.function?.name || "unknown").join(", ")}`
									) : (
										"Tool calls executed"
									)
								) : (
									<i className="italic">–</i>
								))}
						</p>
						<Badge
							variant={log.hasError ? "destructive" : "default"}
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
							<span>{log.cached ? "Cached" : "Not cached"}</span>
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
						<div className="flex items-center gap-1">
							<Coins className="h-3.5 w-3.5" />
							<span>
								{log.cost
									? `$${log.cost.toFixed(6)}`
									: log.cached
										? "$0"
										: "$0"}
							</span>
						</div>
						{log.source && (
							<div className="flex items-center gap-1">
								<LinkIcon className="h-3.5 w-3.5" />
								<span>{log.source}</span>
							</div>
						)}
						<span className="ml-auto">{formattedTime}</span>
					</div>
				</div>
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

			{isExpanded && (
				<div className="space-y-4 p-4">
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Request Details</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
								<div className="text-muted-foreground">Project ID</div>
								<div className="font-mono text-xs">{log.projectId}</div>
								<div className="text-muted-foreground">API Key</div>
								<div className="font-mono text-xs">{log.apiKeyId}</div>
								<div className="text-muted-foreground">Requested Model</div>
								<div>{log.requestedModel}</div>
								<div className="text-muted-foreground">Used Model</div>
								<div>{log.usedModel}</div>
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
						</div>
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Response Metrics</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
								<div className="text-muted-foreground">Duration</div>
								<div>{formatDuration(log.duration ?? 0)}</div>
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
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Cost Information</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
								<div className="text-muted-foreground">Input Cost</div>
								<div>
									{log.inputCost ? `$${log.inputCost.toFixed(6)}` : "$0"}
								</div>
								<div className="text-muted-foreground">Output Cost</div>
								<div>
									{log.outputCost ? `$${log.outputCost.toFixed(6)}` : "$0"}
								</div>
								{!!log.cachedInputCost && Number(log.cachedInputCost) > 0 && (
									<>
										<div className="text-muted-foreground">
											Cached Input Cost
										</div>
										<div className="">
											{`$${Number(log.cachedInputCost).toFixed(6)}`}
										</div>
									</>
								)}
								<div className="text-muted-foreground">Request Cost</div>
								<div>
									{log.requestCost ? `$${log.requestCost.toFixed(6)}` : "$0"}
								</div>
								<div className="text-muted-foreground">Total Cost</div>
								<div className="font-medium">
									{log.cost ? `$${log.cost.toFixed(6)}` : "$0"}
								</div>
								{log.discount && log.discount !== 1 && (
									<>
										<div className="text-muted-foreground">
											Discount Applied
										</div>
										<div className="font-medium text-green-600">
											{((1 - log.discount) * 100).toFixed(0)}% off
										</div>
									</>
								)}
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
								<div className="font-mono text-xs">{log.requestId}</div>
								<div className="text-muted-foreground">Source</div>
								<div className="font-mono text-xs">{log.source || "-"}</div>
								<div className="text-muted-foreground">Project ID</div>
								<div className="font-mono text-xs">{log.projectId}</div>
								<div className="text-muted-foreground">Organization ID</div>
								<div className="font-mono text-xs">{log.organizationId}</div>
								<div className="text-muted-foreground">API Key ID</div>
								<div className="font-mono text-xs">{log.apiKeyId}</div>
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
												log.toolResults.map((toolCall, index: number) => (
													<div key={index} className="rounded-md border p-3">
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
							<pre className="max-h-60 text-xs overflow-auto whitespace-pre-wrap break-words">
								{log.messages ? JSON.stringify(log.messages, null, 2) : "–"}
							</pre>
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
							<pre className="max-h-60 text-xs overflow-auto whitespace-pre-wrap break-words">
								{log.content || "–"}
							</pre>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
