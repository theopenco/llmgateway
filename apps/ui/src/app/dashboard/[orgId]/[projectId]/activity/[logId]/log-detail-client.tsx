"use client";

import { format, formatDistanceToNow } from "date-fns";
import {
	AlertCircle,
	ArrowLeft,
	AudioWaveform,
	Ban,
	CheckCircle2,
	Clock,
	Coins,
	Copy,
	Check,
	Globe,
	Info,
	Package,
	Plug,
	RefreshCw,
	Sparkles,
	TriangleAlert,
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
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { Log } from "@llmgateway/db";

interface LogDetailClientProps {
	initialData: { log: Log } | null;
	orgId: string;
	projectId: string;
	logId: string;
}

function CopyButton({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={() => {
				navigator.clipboard.writeText(value);
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			}}
			className="inline-flex items-center text-muted-foreground/50 hover:text-muted-foreground transition-colors"
		>
			{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
		</button>
	);
}

function Section({
	title,
	children,
	className,
}: {
	title: string;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("space-y-3", className)}>
			<h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
				{title}
			</h3>
			{children}
		</div>
	);
}

function Field({
	label,
	value,
	mono,
	muted,
}: {
	label: string;
	value: React.ReactNode;
	mono?: boolean;
	muted?: boolean;
}) {
	return (
		<div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-border/50 last:border-0">
			<span className="text-sm text-muted-foreground shrink-0">{label}</span>
			<span
				className={cn(
					"text-sm text-right break-all",
					mono && "font-mono text-xs",
					muted && "text-muted-foreground",
				)}
			>
				{value}
			</span>
		</div>
	);
}

function StatusIndicator({ log }: { log: Partial<Log> }) {
	let StatusIcon = CheckCircle2;
	let color = "text-emerald-500";
	let bgColor = "bg-emerald-500/10";
	let label = "Completed";

	if (log.hasError || log.unifiedFinishReason === "error") {
		StatusIcon = AlertCircle;
		color = "text-red-500";
		bgColor = "bg-red-500/10";
		label = "Error";
	} else if (log.unifiedFinishReason === "content_filter") {
		StatusIcon = TriangleAlert;
		color = "text-amber-500";
		bgColor = "bg-amber-500/10";
		label = "Content Filter";
	} else if (
		log.unifiedFinishReason !== "completed" &&
		log.unifiedFinishReason !== "tool_calls"
	) {
		StatusIcon = AlertCircle;
		color = "text-yellow-500";
		bgColor = "bg-yellow-500/10";
		label = log.unifiedFinishReason || "Unknown";
	} else if (log.unifiedFinishReason === "tool_calls") {
		label = "Tool Calls";
	}

	return (
		<div
			className={cn(
				"inline-flex items-center gap-2 rounded-full px-3 py-1.5",
				bgColor,
			)}
		>
			<StatusIcon className={cn("h-4 w-4", color)} />
			<span className={cn("text-sm font-medium", color)}>{label}</span>
		</div>
	);
}

function formatDuration(ms: number) {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	return `${(ms / 1000).toFixed(2)}s`;
}

export function LogDetailClient({
	initialData,
	orgId,
	projectId,
	logId,
}: LogDetailClientProps) {
	const api = useApi();

	const { data } = api.useQuery(
		"get",
		"/logs/{id}",
		{ params: { path: { id: logId } } },
		{
			initialData: initialData
				? {
						log: {
							...initialData.log,
							createdAt:
								initialData.log.createdAt instanceof Date
									? initialData.log.createdAt.toISOString()
									: initialData.log.createdAt,
							updatedAt:
								initialData.log.updatedAt instanceof Date
									? initialData.log.updatedAt.toISOString()
									: initialData.log.updatedAt,
						},
					}
				: undefined,
			refetchOnWindowFocus: false,
			staleTime: 5 * 60 * 1000,
		},
	);

	if (!data?.log) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
				<p className="text-muted-foreground">Log not found</p>
				<Button asChild variant="outline" size="sm">
					<Link href={`/dashboard/${orgId}/${projectId}/activity`}>
						<ArrowLeft className="mr-2 h-4 w-4" />
						Back to Activity
					</Link>
				</Button>
			</div>
		);
	}

	const log = {
		...data.log,
		createdAt: new Date(data.log.createdAt),
		updatedAt: new Date(data.log.updatedAt),
	} as Log;

	const retentionEnabled =
		log.dataStorageCost !== null &&
		log.dataStorageCost !== undefined &&
		Number(log.dataStorageCost) > 0;

	const throughput =
		log.duration && log.totalTokens
			? (Number(log.totalTokens) / (log.duration / 1000)).toFixed(1)
			: null;

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
				{/* Header */}
				<div className="space-y-4">
					<Button asChild variant="ghost" size="sm" className="-ml-2">
						<Link href={`/dashboard/${orgId}/${projectId}/activity`}>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Activity Logs
						</Link>
					</Button>

					<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
						<div className="space-y-2">
							<div className="flex items-center gap-3">
								<h1 className="text-2xl font-bold tracking-tight">
									{log.usedModel}
								</h1>
								<StatusIndicator log={log} />
								{log.retried && (
									<div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-amber-500/10">
										<RefreshCw className="h-4 w-4 text-amber-600" />
										<span className="text-sm font-medium text-amber-600">
											Retried
										</span>
									</div>
								)}
							</div>
							<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
								<span>
									{format(log.createdAt, "MMM d, yyyy 'at' HH:mm:ss")}
								</span>
								<span>
									({formatDistanceToNow(log.createdAt, { addSuffix: true })})
								</span>
							</div>
						</div>
					</div>
				</div>

				{/* Quick stats row */}
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
					<div className="rounded-lg border bg-card p-3">
						<div className="flex items-center gap-2 text-muted-foreground mb-1">
							<Clock className="h-3.5 w-3.5" />
							<span className="text-xs">Duration</span>
						</div>
						<p className="text-lg font-semibold tabular-nums">
							{formatDuration(log.duration ?? 0)}
						</p>
					</div>
					<div className="rounded-lg border bg-card p-3">
						<div className="flex items-center gap-2 text-muted-foreground mb-1">
							<Zap className="h-3.5 w-3.5" />
							<span className="text-xs">Tokens</span>
						</div>
						<p className="text-lg font-semibold tabular-nums">
							{Number(log.totalTokens || 0).toLocaleString()}
						</p>
					</div>
					<div className="rounded-lg border bg-card p-3">
						<div className="flex items-center gap-2 text-muted-foreground mb-1">
							<AudioWaveform className="h-3.5 w-3.5" />
							<span className="text-xs">Throughput</span>
						</div>
						<p className="text-lg font-semibold tabular-nums">
							{throughput ? `${throughput} t/s` : "-"}
						</p>
					</div>
					{log.timeToFirstToken && (
						<div className="rounded-lg border bg-card p-3">
							<div className="flex items-center gap-2 text-muted-foreground mb-1">
								<Clock className="h-3.5 w-3.5" />
								<span className="text-xs">TTFT</span>
							</div>
							<p className="text-lg font-semibold tabular-nums">
								{formatDuration(log.timeToFirstToken)}
							</p>
						</div>
					)}
					<div className="rounded-lg border bg-card p-3">
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<div>
										<div className="flex items-center gap-2 text-muted-foreground mb-1">
											<Coins className="h-3.5 w-3.5" />
											<span className="text-xs">Inference Cost</span>
											<Info className="h-3 w-3 text-muted-foreground/40" />
										</div>
										<p className="text-lg font-semibold tabular-nums text-muted-foreground">
											${log.cost?.toFixed(6) || "0"}
										</p>
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
					</div>
					<div className="rounded-lg border bg-card p-3">
						<div className="flex items-center gap-2 text-muted-foreground mb-1">
							<Package className="h-3.5 w-3.5" />
							<span className="text-xs">Cache</span>
						</div>
						<p className="text-lg font-semibold tabular-nums">
							{log.cached
								? "Full"
								: log.cachedTokens && Number(log.cachedTokens) > 0
									? "Partial"
									: "None"}
						</p>
					</div>
				</div>

				{/* Main content grid */}
				<div className="grid gap-6 lg:grid-cols-2">
					{/* Left column */}
					<div className="space-y-6">
						<Section title="Request">
							<div className="rounded-lg border bg-card p-4">
								<Field
									label="Requested Model"
									value={log.requestedModel}
									mono
								/>
								<Field label="Used Model" value={log.usedModel} mono />
								{log.usedModelMapping && (
									<Field
										label="Model Mapping"
										value={log.usedModelMapping}
										mono
									/>
								)}
								<Field label="Provider" value={log.usedProvider} />
								{log.requestedProvider && (
									<Field
										label="Requested Provider"
										value={log.requestedProvider}
									/>
								)}
								<Field
									label="Streamed"
									value={
										log.streamed ? (
											<span className="inline-flex items-center gap-1">
												<AudioWaveform className="h-3 w-3 text-emerald-500" />
												Yes
											</span>
										) : (
											"No"
										)
									}
								/>
								<Field
									label="Canceled"
									value={
										log.canceled ? (
											<span className="inline-flex items-center gap-1">
												<Ban className="h-3 w-3 text-amber-500" />
												Yes
											</span>
										) : (
											"No"
										)
									}
								/>
								{log.source && <Field label="Source" value={log.source} />}
							</div>
						</Section>

						{log.routingMetadata && (
							<Section title="Routing">
								<div className="rounded-lg border bg-card p-4">
									{log.routingMetadata.selectionReason && (
										<Field
											label="Selection"
											value={log.routingMetadata.selectionReason}
											mono
										/>
									)}
									{log.routingMetadata.availableProviders &&
										log.routingMetadata.availableProviders.length > 0 && (
											<Field
												label="Available"
												value={log.routingMetadata.availableProviders.join(
													", ",
												)}
												mono
											/>
										)}
									{log.routingMetadata.providerScores &&
										log.routingMetadata.providerScores.length > 0 && (
											<div className="mt-3 pt-3 border-t border-border/50">
												<p className="text-xs text-muted-foreground mb-2">
													Provider Scores
												</p>
												<div className="space-y-1.5">
													{log.routingMetadata.providerScores.map((score) => (
														<div
															key={score.providerId}
															className="flex items-center justify-between text-xs font-mono"
														>
															<span className="flex items-center gap-1.5">
																{score.providerId}
																{score.failed && (
																	<span className="inline-flex items-center gap-0.5 text-red-500">
																		<AlertCircle className="h-3 w-3" />
																		<span>
																			{score.status_code}
																			{score.error_type && (
																				<span className="ml-0.5 text-red-400">
																					{score.error_type}
																				</span>
																			)}
																		</span>
																	</span>
																)}
															</span>
															<span className="text-muted-foreground">
																{score.score.toFixed(2)}
																{score.uptime !== undefined && (
																	<span className="ml-2">
																		{score.uptime?.toFixed(0)}% up
																	</span>
																)}
																{score.latency !== undefined && (
																	<span className="ml-2">
																		{score.latency?.toFixed(0)}ms
																	</span>
																)}
															</span>
														</div>
													))}
												</div>
											</div>
										)}
									{log.routingMetadata.routing &&
										log.routingMetadata.routing.length > 0 && (
											<div className="mt-3 pt-3 border-t border-border/50">
												<p className="text-xs text-muted-foreground mb-2">
													Request Attempts
												</p>
												<div className="space-y-1.5">
													{log.routingMetadata.routing.map((attempt, i) => (
														<div
															key={`${attempt.provider}-${i}`}
															className={`flex items-center justify-between text-xs font-mono ${attempt.succeeded ? "text-green-600" : "text-red-500"}`}
														>
															<span className="flex items-center gap-1">
																{attempt.succeeded ? (
																	<CheckCircle2 className="h-3 w-3" />
																) : (
																	<AlertCircle className="h-3 w-3" />
																)}
																{attempt.provider}/{attempt.model}
															</span>
															<span>
																{attempt.status_code}{" "}
																{attempt.succeeded ? "ok" : attempt.error_type}
															</span>
														</div>
													))}
												</div>
											</div>
										)}
								</div>
							</Section>
						)}

						<Section title="Cost Information">
							<div className="rounded-lg border bg-card p-4 space-y-4">
								<div>
									<p className="text-xs text-muted-foreground mb-2">
										Provider pricing
										{log.usedMode === "api-keys" &&
											" — not deducted from your balance"}
									</p>
									<div className="text-muted-foreground">
										<Field
											label="Input Cost"
											value={
												log.inputCost ? `$${log.inputCost.toFixed(8)}` : "$0"
											}
											muted
										/>
										<Field
											label="Output Cost"
											value={
												log.outputCost ? `$${log.outputCost.toFixed(8)}` : "$0"
											}
											muted
										/>
										{!!log.cachedInputCost &&
											Number(log.cachedInputCost) > 0 && (
												<Field
													label="Cached Input Cost"
													value={`$${Number(log.cachedInputCost).toFixed(8)}`}
													muted
												/>
											)}
										<Field
											label="Request Cost"
											value={
												log.requestCost
													? `$${log.requestCost.toFixed(8)}`
													: "$0"
											}
											muted
										/>
										{!!log.webSearchCost && Number(log.webSearchCost) > 0 && (
											<Field
												label="Web Search Cost"
												value={`$${Number(log.webSearchCost).toFixed(8)}`}
												muted
											/>
										)}
										{!!log.imageInputCost && Number(log.imageInputCost) > 0 && (
											<Field
												label="Image Input Cost"
												value={`$${Number(log.imageInputCost).toFixed(8)}`}
												muted
											/>
										)}
										{!!log.imageOutputCost &&
											Number(log.imageOutputCost) > 0 && (
												<Field
													label="Image Output Cost"
													value={`$${Number(log.imageOutputCost).toFixed(8)}`}
													muted
												/>
											)}
										<Field
											label="Inference Total"
											value={log.cost ? `$${log.cost.toFixed(8)}` : "$0"}
											muted
										/>
										{log.discount && log.discount !== 1 && (
											<Field
												label="Discount"
												value={
													<span className="text-emerald-500">
														{(log.discount * 100).toFixed(0)}% off
													</span>
												}
											/>
										)}
										{log.pricingTier && (
											<Field label="Pricing Tier" value={log.pricingTier} />
										)}
									</div>
								</div>
								<div className="border-t border-border/50 pt-4">
									<p className="text-xs font-medium mb-2">
										Billed to your organization
									</p>
									<Field
										label="Data Storage"
										value={
											log.dataStorageCost
												? `$${Number(log.dataStorageCost).toFixed(8)}`
												: "$0"
										}
									/>
									{log.usedMode === "api-keys" && (
										<Field
											label="API Key Fee (1%)"
											value={
												log.serviceFee
													? `$${Number(log.serviceFee).toFixed(8)}`
													: log.cost
														? `$${(Number(log.cost) * 0.01).toFixed(8)}`
														: "$0"
											}
										/>
									)}
								</div>
							</div>
						</Section>
					</div>

					{/* Right column */}
					<div className="space-y-6">
						<Section title="Tokens">
							<div className="rounded-lg border bg-card p-4">
								<Field label="Prompt Tokens" value={log.promptTokens} />
								<Field label="Completion Tokens" value={log.completionTokens} />
								<Field label="Total Tokens" value={log.totalTokens} />
								{log.cachedTokens && Number(log.cachedTokens) > 0 && (
									<Field label="Cached Input Tokens" value={log.cachedTokens} />
								)}
								{log.reasoningTokens && (
									<Field label="Reasoning Tokens" value={log.reasoningTokens} />
								)}
								{log.imageInputTokens && Number(log.imageInputTokens) > 0 && (
									<Field
										label="Image Input Tokens"
										value={log.imageInputTokens}
									/>
								)}
								{log.imageOutputTokens && Number(log.imageOutputTokens) > 0 && (
									<Field
										label="Image Output Tokens"
										value={log.imageOutputTokens}
									/>
								)}
								<Field
									label="Response Size"
									value={
										log.responseSize
											? `${prettyBytes(log.responseSize)} (${log.responseSize} bytes)`
											: "Unknown"
									}
								/>
							</div>
						</Section>

						<Section title="Parameters">
							<div className="rounded-lg border bg-card p-4">
								<TooltipProvider>
									<Field label="Temperature" value={log.temperature ?? "-"} />
									<Field label="Max Tokens" value={log.maxTokens ?? "-"} />
									<Field label="Top P" value={log.topP ?? "-"} />
									<Field
										label="Frequency Penalty"
										value={log.frequencyPenalty ?? "-"}
									/>
									<Field
										label="Reasoning Effort"
										value={log.reasoningEffort || "-"}
									/>
									{log.effort && <Field label="Effort" value={log.effort} />}
									<Field
										label="Response Format"
										value={
											log.responseFormat
												? typeof log.responseFormat === "object"
													? (log.responseFormat as any).type || "-"
													: "-"
												: "-"
										}
									/>
									<Field
										label="Finish Reason"
										value={log.finishReason || "-"}
									/>
									<Field
										label="Unified Finish Reason"
										value={log.unifiedFinishReason || "-"}
									/>
								</TooltipProvider>
							</div>
						</Section>

						<Section title="Metadata">
							<div className="rounded-lg border bg-card p-4">
								<Field
									label="Request ID"
									value={
										<span className="inline-flex items-center gap-2">
											<span className="font-mono text-xs">{log.requestId}</span>
											<CopyButton value={log.requestId} />
										</span>
									}
								/>
								<Field
									label="Log ID"
									value={
										<span className="inline-flex items-center gap-2">
											<span className="font-mono text-xs">{log.id}</span>
											<CopyButton value={log.id} />
										</span>
									}
								/>
								<Field
									label="Project ID"
									value={
										<span className="font-mono text-xs">{log.projectId}</span>
									}
								/>
								<Field
									label="API Key ID"
									value={
										<span className="font-mono text-xs">{log.apiKeyId}</span>
									}
								/>
								<Field label="Mode" value={log.mode || "?"} />
								<Field label="Used Mode" value={log.usedMode || "?"} />
								<Field
									label="Date"
									value={format(log.createdAt, "dd.MM.yyyy HH:mm:ss")}
									mono
								/>
							</div>
							{log.customHeaders &&
								Object.keys(log.customHeaders).length > 0 && (
									<div className="rounded-lg border bg-card p-4 mt-3">
										<p className="text-xs text-muted-foreground mb-2">
											Custom Headers
										</p>
										{Object.entries(log.customHeaders).map(([key, value]) => (
											<Field key={key} label={key} value={String(value)} mono />
										))}
									</div>
								)}
						</Section>
					</div>
				</div>

				{/* Full-width sections */}
				{log.plugins && log.plugins.length > 0 && (
					<Section title="Plugins">
						<div className="rounded-lg border bg-card p-4 space-y-3">
							<div className="flex flex-wrap gap-2">
								{log.plugins.map((plugin) => (
									<Badge key={plugin} variant="secondary" className="gap-1">
										<Plug className="h-3 w-3" />
										{plugin}
									</Badge>
								))}
							</div>
							{log.pluginResults?.responseHealing && (
								<div className="pt-3 border-t border-border/50">
									<div className="flex items-center gap-2 text-sm">
										<Sparkles
											className={cn(
												"h-3.5 w-3.5",
												log.pluginResults.responseHealing.healed
													? "text-emerald-500"
													: "text-muted-foreground",
											)}
										/>
										<span>
											Response Healing:{" "}
											{log.pluginResults.responseHealing.healed ? (
												<span className="text-emerald-500 font-medium">
													Applied
													{log.pluginResults.responseHealing.healingMethod && (
														<span className="text-muted-foreground font-normal ml-1">
															(
															{log.pluginResults.responseHealing.healingMethod
																.replace(/_/g, " ")
																.replace(/\b\w/g, (l: string) =>
																	l.toUpperCase(),
																)}
															)
														</span>
													)}
												</span>
											) : (
												<span className="text-muted-foreground">
													Not needed
												</span>
											)}
										</span>
									</div>
								</div>
							)}
						</div>
					</Section>
				)}

				{(log.tools || log.toolChoice || log.toolResults) && (
					<Section title="Tools">
						<div className="space-y-3">
							{log.tools && (
								<div className="rounded-lg border bg-card p-4">
									<p className="text-xs text-muted-foreground mb-2">
										Available Tools
									</p>
									<pre className="max-h-48 text-xs overflow-auto whitespace-pre-wrap break-words font-mono bg-muted/30 rounded-md p-3">
										{JSON.stringify(log.tools, null, 2)}
									</pre>
								</div>
							)}
							{log.toolChoice && (
								<div className="rounded-lg border bg-card p-4">
									<p className="text-xs text-muted-foreground mb-2">
										Tool Choice
									</p>
									<pre className="max-h-48 text-xs overflow-auto whitespace-pre-wrap break-words font-mono bg-muted/30 rounded-md p-3">
										{JSON.stringify(log.toolChoice, null, 2)}
									</pre>
								</div>
							)}
							{log.toolResults && (
								<div className="rounded-lg border bg-card p-4">
									<p className="text-xs text-muted-foreground mb-2">
										Tool Calls
									</p>
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
														className="rounded-md bg-muted/30 p-3"
													>
														<div className="flex justify-between items-center mb-2">
															<span className="text-sm font-medium">
																{toolCall.function?.name || "Unknown"}
															</span>
															<span className="text-xs text-muted-foreground font-mono">
																{toolCall.id || "N/A"}
															</span>
														</div>
														{toolCall.function?.arguments && (
															<pre className="text-xs overflow-auto whitespace-pre-wrap break-words font-mono bg-background rounded border p-2 max-h-32">
																{typeof toolCall.function.arguments === "string"
																	? toolCall.function.arguments
																	: JSON.stringify(
																			toolCall.function.arguments,
																			null,
																			2,
																		)}
															</pre>
														)}
													</div>
												))
										) : (
											<pre className="max-h-48 text-xs overflow-auto whitespace-pre-wrap break-words font-mono bg-muted/30 rounded-md p-3">
												{JSON.stringify(log.toolResults, null, 2)}
											</pre>
										)}
									</div>
								</div>
							)}
						</div>
					</Section>
				)}

				{!!log.webSearchCost && Number(log.webSearchCost) > 0 && (
					<Section title="Builtin Tools">
						<div className="rounded-lg border bg-card p-4">
							<div className="flex items-center gap-2 text-sm">
								<Globe className="h-4 w-4 text-sky-500" />
								<span>Web search was used in this request</span>
								<span className="ml-auto text-muted-foreground">
									Cost: ${Number(log.webSearchCost).toFixed(4)}
								</span>
							</div>
						</div>
					</Section>
				)}

				{log.hasError && !!log.errorDetails && (
					<Section title="Error Details">
						<div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 space-y-3">
							<div className="flex gap-6">
								<div>
									<p className="text-xs text-red-400 mb-0.5">Status Code</p>
									<p className="text-sm font-semibold">
										{log.errorDetails.statusCode}
									</p>
								</div>
								<div>
									<p className="text-xs text-red-400 mb-0.5">Status Text</p>
									<p className="text-sm font-semibold">
										{log.errorDetails.statusText}
									</p>
								</div>
							</div>
							<div>
								<p className="text-xs text-red-400 mb-1">Error Message</p>
								<pre className="text-xs overflow-auto whitespace-pre-wrap break-words font-mono bg-background rounded border p-3">
									{log.errorDetails.responseText}
								</pre>
							</div>
							{log.retried && log.retriedByLogId && (
								<div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm">
									<RefreshCw className="h-4 w-4 text-amber-600" />
									<span className="text-amber-700">
										This request was retried and succeeded.
									</span>
									<Link
										href={`/dashboard/${orgId}/${projectId}/activity/${log.retriedByLogId}`}
										className="text-amber-600 underline hover:text-amber-800 ml-auto"
									>
										View successful request
									</Link>
								</div>
							)}
						</div>
					</Section>
				)}

				<Section title="Messages">
					<div className="rounded-lg border bg-card p-4">
						{log.messages ? (
							<pre className="max-h-80 text-xs overflow-auto whitespace-pre-wrap break-words font-mono bg-muted/30 rounded-md p-3">
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
						{!!log.responseFormat && (
							<div className="mt-3 pt-3 border-t border-border/50">
								<p className="text-xs text-muted-foreground mb-2">
									Response Format
								</p>
								<pre className="max-h-40 text-xs overflow-auto whitespace-pre-wrap break-words font-mono bg-muted/30 rounded-md p-3">
									{JSON.stringify(log.responseFormat, null, 2)}
								</pre>
							</div>
						)}
					</div>
				</Section>

				{log.reasoningContent && (
					<Section title="Reasoning Content">
						<div className="rounded-lg border bg-card p-4">
							<pre className="max-h-80 text-xs overflow-auto whitespace-pre-wrap break-words font-mono bg-muted/30 rounded-md p-3">
								{log.reasoningContent}
							</pre>
						</div>
					</Section>
				)}

				<Section title="Response">
					<div className="rounded-lg border bg-card p-4">
						{log.content ? (
							<pre className="max-h-80 text-xs overflow-auto whitespace-pre-wrap break-words font-mono bg-muted/30 rounded-md p-3">
								{log.content}
							</pre>
						) : !retentionEnabled ? (
							<p className="text-sm text-muted-foreground italic">
								Response content not retained. Enable retention in organization
								policies to store response data.
							</p>
						) : (
							<p className="text-sm text-muted-foreground italic">
								No response content available.
							</p>
						)}
					</div>
				</Section>

				{log.params && Object.keys(log.params).length > 0 && (
					<Section title="Additional Parameters">
						<div className="rounded-lg border bg-card p-4">
							<pre className="max-h-48 text-xs overflow-auto whitespace-pre-wrap break-words font-mono bg-muted/30 rounded-md p-3">
								{JSON.stringify(log.params, null, 2)}
							</pre>
						</div>
					</Section>
				)}
			</div>
		</div>
	);
}
