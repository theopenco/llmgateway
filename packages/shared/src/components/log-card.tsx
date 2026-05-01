"use client";

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
	Copy,
	Eye,
	ExternalLink,
	Globe,
	Info,
	Loader2,
	Link as LinkIcon,
	Package,
	Plug,
	RefreshCw,
	Sparkles,
	TrendingDown,
	TriangleAlert,
	Zap,
} from "lucide-react";
import prettyBytes from "pretty-bytes";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoutingMetadata {
	selectionReason?: string;
	usedApiKeyHash?: string;
	availableProviders?: string[];
	xNoFallbackHeaderSet?: boolean;
	noFallback?: boolean;
	providerScores?: Array<{
		providerId: string;
		region?: string;
		score: number;
		uptime?: number;
		throughput?: number;
		latency?: number;
		price?: number;
		priority?: number;
		cacheSupported?: boolean;
		failed?: boolean;
		status_code?: number;
		error_type?: string;
		rate_limited?: boolean;
		contentFilterProvider?: boolean;
		excludedByContentFilter?: boolean;
	}>;
	contentFilterMatched?: boolean;
	contentFilterRerouted?: boolean;
	contentFilterExcludedProviders?: string[];
	routing?: Array<{
		provider: string;
		model: string;
		region?: string;
		succeeded: boolean;
		status_code?: number;
		error_type?: string;
		apiKeyHash?: string;
		logId?: string;
	}>;
}

interface ErrorDetails {
	statusCode?: number;
	statusText?: string;
	responseText?: string;
}

interface PluginResults {
	responseHealing?: {
		healed: boolean;
		healingMethod?: string;
	};
}

interface ToolCall {
	id?: string;
	function?: {
		name?: string;
		arguments?: string | Record<string, unknown>;
	};
}

/** Normalised log shape consumed by the shared LogCard. */
export interface LogCardData {
	id: string;
	content?: string | null;
	reasoningContent?: string | null;
	hasError?: boolean | null;
	unifiedFinishReason?: string | null;
	usedModel?: string | null;
	usedModelMapping?: string | null;
	usedProvider?: string | null;
	requestedModel?: string | null;
	cached?: boolean | null;
	cachedTokens?: string | number | null;
	totalTokens?: string | number | null;
	promptTokens?: string | number | null;
	completionTokens?: string | number | null;
	reasoningTokens?: string | number | null;
	imageInputTokens?: string | number | null;
	imageOutputTokens?: string | number | null;
	duration?: number | null;
	timeToFirstToken?: number | null;
	timeToFirstReasoningToken?: number | null;
	responseSize?: number | null;
	finishReason?: string | null;
	streamed?: boolean | null;
	canceled?: boolean | null;
	cost?: number | null;
	inputCost?: number | null;
	outputCost?: number | null;
	cachedInputCost?: number | string | null;
	requestCost?: number | null;
	webSearchCost?: number | string | null;
	imageInputCost?: number | string | null;
	imageOutputCost?: number | string | null;
	videoOutputCost?: number | string | null;
	discount?: number | null;
	pricingTier?: string | null;
	dataStorageCost?: number | string | null;
	createdAt: string | Date;
	requestId?: string | null;
	projectId?: string | null;
	organizationId?: string | null;
	apiKeyId?: string | null;
	source?: string | null;
	mode?: string | null;
	usedMode?: string | null;
	retried?: boolean | null;
	retriedByLogId?: string | null;
	temperature?: number | null;
	maxTokens?: number | null;
	topP?: number | null;
	frequencyPenalty?: number | null;
	presencePenalty?: number | null;
	reasoningEffort?: string | null;
	reasoningMaxTokens?: number | null;
	effort?: string | null;
	plugins?: string[] | null;
	routingMetadata?: unknown;
	errorDetails?: unknown;
	pluginResults?: unknown;
	toolResults?: unknown;
	tools?: unknown;
	toolChoice?: unknown;
	messages?: unknown;
	responseFormat?: unknown;
	params?: unknown;
	customHeaders?: unknown;
}

export interface LogCardProps {
	log: LogCardData;
	/** Return a URL string to enable clickable detail links (e.g. image-generated, external-link button). */
	getDetailUrl?: (logId: string) => string;
	/** Return a URL string for the retried-request link. */
	getRetriedUrl?: (logId: string) => string;
	/** Render a link element. Defaults to a plain `<a>`. Override with next/link in Next.js apps. */
	renderLink?: (props: {
		href: string;
		className?: string;
		children: React.ReactNode;
	}) => React.ReactNode;
	/** Show copy-to-clipboard buttons in metadata section. */
	showCopyButtons?: boolean;
	/** Show the Log ID row in metadata section. */
	showLogId?: boolean;
	/** When true, uses "your balance" / "your organization" wording. */
	isUserFacing?: boolean;
	/** Fetch full image content (base64) for a log. When provided, a Preview button appears for image logs. */
	fetchImageContent?: (logId: string) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number) {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	return `${(ms / 1000).toFixed(2)}s`;
}

function formatApiKeyHash(hash: string) {
	return hash.slice(0, 7);
}

function copyToClipboard(text: string) {
	void navigator.clipboard.writeText(text);
}

function renderParams(obj: Record<string, any>, depth = 0): React.ReactNode {
	return Object.entries(obj).flatMap(([key, value]) => {
		if (value === null || value === undefined) {
			return [];
		}

		if (typeof value === "object" && !Array.isArray(value)) {
			return renderParams(value, depth + 1);
		}

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
}

function DefaultLink({
	href,
	className,
	children,
}: {
	href: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<a href={href} className={className}>
			{children}
		</a>
	);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LogCard({
	log,
	getDetailUrl,
	getRetriedUrl,
	renderLink: LinkComponent = DefaultLink,
	showCopyButtons = false,
	showLogId = false,
	isUserFacing = false,
	fetchImageContent,
}: LogCardProps) {
	const routingMetadata = log.routingMetadata as RoutingMetadata | undefined;
	const errorDetails = log.errorDetails as ErrorDetails | undefined;
	const pluginResults = log.pluginResults as PluginResults | undefined;
	const toolResults = log.toolResults as ToolCall[] | undefined;
	const tools = log.tools as unknown[] | undefined;
	const toolChoice = log.toolChoice as
		| Record<string, unknown>
		| string
		| undefined;
	const messages = log.messages as unknown | undefined;
	const responseFormat = log.responseFormat as { type?: string } | undefined;
	const params = log.params as Record<string, any> | undefined;
	const customHeaders = log.customHeaders as Record<string, string> | undefined;

	// Extract image_config from params and compute remaining params
	const imageConfig = params?.image_config as
		| Record<string, string | number>
		| undefined;
	const remainingParams = params
		? Object.fromEntries(
				Object.entries(params).filter(([key]) => key !== "image_config"),
			)
		: undefined;

	const retentionEnabled =
		log.dataStorageCost !== null &&
		log.dataStorageCost !== undefined &&
		Number(log.dataStorageCost) > 0;
	const [isExpanded, setIsExpanded] = useState(false);
	const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
	const [imagePreviewSrcs, setImagePreviewSrcs] = useState<string[]>([]);
	const [imagePreviewLoading, setImagePreviewLoading] = useState(false);

	const formattedTime = formatDistanceToNow(new Date(log.createdAt), {
		addSuffix: true,
	});

	const detailUrl = getDetailUrl?.(log.id);

	// Status icon logic
	let StatusIcon = CheckCircle2;
	let color = "text-green-500";
	let bgColor = "bg-green-100 dark:bg-green-900/30";

	if (log.hasError || log.unifiedFinishReason === "error") {
		StatusIcon = AlertCircle;
		color = "text-red-500";
		bgColor = "bg-red-100 dark:bg-red-900/30";
	} else if (log.unifiedFinishReason === "content_filter") {
		StatusIcon = TriangleAlert;
		color = "text-orange-500";
		bgColor = "bg-orange-100 dark:bg-orange-900/30";
	} else if (
		log.unifiedFinishReason !== "completed" &&
		log.unifiedFinishReason !== "tool_calls"
	) {
		StatusIcon = AlertCircle;
		color = "text-yellow-500";
		bgColor = "bg-yellow-100 dark:bg-yellow-900/30";
	}

	return (
		<div className="rounded-lg border bg-card text-card-foreground shadow-sm max-w-full overflow-hidden">
			{/* ── Collapsed header ── */}
			<div
				className={`flex items-start gap-4 p-4 ${isExpanded ? "border-b" : ""}`}
			>
				<div className={`mt-0.5 rounded-full p-1 ${bgColor} shrink-0`}>
					<StatusIcon className={`h-4 w-4 ${color}`} />
				</div>
				<div className="flex-1 space-y-1 min-w-0">
					<div className="flex items-start justify-between gap-4">
						<div className="flex items-center gap-2 flex-1 min-w-0">
							<p className="font-medium break-words max-w-none line-clamp-2">
								{log.content === "[image_generated]" ? (
									detailUrl ? (
										<LinkComponent
											href={detailUrl}
											className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
										>
											<Sparkles className="h-3.5 w-3.5" />
											Image generated — view details
										</LinkComponent>
									) : (
										<span className="text-muted-foreground inline-flex items-center gap-1">
											<Sparkles className="h-3.5 w-3.5" />
											Image generated
										</span>
									)
								) : (
									(log.content ??
									(log.unifiedFinishReason === "tool_calls" && toolResults
										? Array.isArray(toolResults)
											? `Tool calls: ${toolResults.map((tr) => tr.function?.name ?? "unknown").join(", ")}`
											: "Tool calls executed"
										: "---"))
								)}
							</p>
							{isUserFacing &&
								!log.content &&
								log.unifiedFinishReason !== "tool_calls" &&
								!log.hasError &&
								!log.canceled &&
								!retentionEnabled && (
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
								)}
						</div>
						<div className="flex items-center gap-1.5 flex-shrink-0">
							{log.retried && (
								<Badge
									variant="outline"
									className="gap-1 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30"
								>
									<RefreshCw className="h-3 w-3" />
									Retried
								</Badge>
							)}
							<Badge
								variant={
									log.hasError
										? "destructive"
										: log.unifiedFinishReason === "content_filter"
											? "destructive"
											: "default"
								}
							>
								{log.unifiedFinishReason}
							</Badge>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-sm text-muted-foreground">
						<div className="flex items-center gap-1">
							<Package className="h-3.5 w-3.5 shrink-0" />
							<span className="truncate">
								{log.usedModel === "" ? "—" : log.usedModel}
							</span>
						</div>
						<div className="flex items-center gap-1">
							<Zap className="h-3.5 w-3.5 shrink-0" />
							<span>
								{log.cached
									? "Fully cached"
									: log.cachedTokens && Number(log.cachedTokens) > 0
										? "Partially cached"
										: "Not cached"}
							</span>
						</div>
						<div className="flex items-center gap-1">
							<Clock className="h-3.5 w-3.5 shrink-0" />
							<span>
								{log.totalTokens} tokens
								{log.cachedTokens && Number(log.cachedTokens) > 0 && (
									<span className="ml-1">({log.cachedTokens} cached)</span>
								)}
							</span>
						</div>
						<div className="flex items-center gap-1">
							<Clock className="h-3.5 w-3.5 shrink-0" />
							<span>{formatDuration(log.duration ?? 0)}</span>
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
										(isUserFacing
											? " — not deducted from your balance"
											: " — not deducted from balance")}
								</p>
							</TooltipContent>
						</Tooltip>
						{log.discount && log.discount !== 1 && (
							<div className="flex items-center gap-1 text-emerald-600">
								<TrendingDown className="h-3.5 w-3.5 shrink-0" />
								<span>{(log.discount * 100).toFixed(0)}% off</span>
							</div>
						)}
						{log.source && (
							<div className="flex items-center gap-1">
								<LinkIcon className="h-3.5 w-3.5 shrink-0" />
								<span>{log.source}</span>
							</div>
						)}
						{log.plugins && log.plugins.length > 0 && (
							<div className="flex items-center gap-1">
								<Plug className="h-3.5 w-3.5 shrink-0" />
								<span>
									{log.plugins.length} plugin{log.plugins.length > 1 ? "s" : ""}
								</span>
							</div>
						)}
						<span className="ml-auto">{formattedTime}</span>
					</div>
				</div>
				<div className="flex items-center gap-1 shrink-0">
					{detailUrl && (
						<Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
							<LinkComponent href={detailUrl}>
								<ExternalLink className="h-4 w-4" />
								<span className="sr-only">View details</span>
							</LinkComponent>
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						className="h-8 w-8 p-0"
						onClick={() => setIsExpanded(!isExpanded)}
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

			{/* ── Expanded content ── */}
			{isExpanded && (
				<div className="space-y-4 p-4">
					{/* Request details + Response metrics */}
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
									{log.usedModel === "" ? "—" : log.usedModel}
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
							{routingMetadata && (
								<div className="mt-3">
									<h5 className="text-xs font-medium text-muted-foreground mb-2">
										Routing Info
									</h5>
									<div className="rounded-md border border-dashed p-2 text-xs space-y-1.5 bg-muted/30">
										{routingMetadata.selectionReason && (
											<div className="flex justify-between">
												<span className="text-muted-foreground">Selection</span>
												<span className="font-mono">
													{routingMetadata.selectionReason}
												</span>
											</div>
										)}
										{routingMetadata.usedApiKeyHash && (
											<div className="flex justify-between">
												<span className="text-muted-foreground">Key</span>
												<span className="font-mono">
													{formatApiKeyHash(routingMetadata.usedApiKeyHash)}
												</span>
											</div>
										)}
										{routingMetadata.xNoFallbackHeaderSet !== undefined && (
											<div className="flex justify-between">
												<span className="text-muted-foreground">
													X-No-Fallback
												</span>
												<span className="font-mono">
													{routingMetadata.xNoFallbackHeaderSet
														? "set"
														: "unset"}
													{routingMetadata.noFallback ? " (active)" : ""}
												</span>
											</div>
										)}
										{routingMetadata.availableProviders &&
											routingMetadata.availableProviders.length > 0 && (
												<div className="flex justify-between">
													<span className="text-muted-foreground">
														Available
													</span>
													<span className="font-mono">
														{routingMetadata.availableProviders.join(", ")}
													</span>
												</div>
											)}
										{routingMetadata.providerScores &&
											routingMetadata.providerScores.length > 0 && (
												<div className="pt-1 border-t border-dashed">
													<div className="text-muted-foreground mb-1">
														Scores
													</div>
													<div className="space-y-1">
														{routingMetadata.providerScores.map((score) => (
															<div
																key={`${score.providerId}-${score.region ?? "default"}`}
																className="flex justify-between items-center"
															>
																<span className="font-mono flex items-center gap-1.5">
																	{score.providerId}
																	{score.region && (
																		<span className="text-muted-foreground">
																			({score.region})
																		</span>
																	)}
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
																	{score.rate_limited && (
																		<span className="inline-flex items-center gap-0.5 text-amber-500">
																			<Clock className="h-3 w-3" />
																			<span>rpm capped</span>
																		</span>
																	)}
																	{score.excludedByContentFilter && (
																		<span className="inline-flex items-center gap-0.5 text-amber-500">
																			<Ban className="h-3 w-3" />
																			<span>content filter</span>
																		</span>
																	)}
																</span>
																<span className="text-muted-foreground font-mono">
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
																	{score.cacheSupported && (
																		<span className="ml-2">cache</span>
																	)}
																</span>
															</div>
														))}
													</div>
												</div>
											)}
										{routingMetadata.routing &&
											routingMetadata.routing.length > 0 && (
												<div className="pt-1 border-t border-dashed">
													<div className="text-muted-foreground mb-1">
														Request Attempts
													</div>
													<div className="space-y-1">
														{routingMetadata.routing.map((attempt, i) => (
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
																	{attempt.region && (
																		<span className="text-muted-foreground">
																			({attempt.region})
																		</span>
																	)}
																	{attempt.apiKeyHash && (
																		<span className="text-muted-foreground">
																			key {formatApiKeyHash(attempt.apiKeyHash)}
																		</span>
																	)}
																	{attempt.logId &&
																		(getDetailUrl ? (
																			<LinkComponent
																				href={getDetailUrl(attempt.logId)}
																				className="text-muted-foreground hover:underline"
																			>
																				log {attempt.logId}
																			</LinkComponent>
																		) : (
																			<span className="text-muted-foreground">
																				log {attempt.logId}
																			</span>
																		))}
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
								{log.timeToFirstToken !== null &&
									log.timeToFirstToken !== undefined && (
										<>
											<div className="text-muted-foreground">
												Time to First Token
											</div>
											<div>{formatDuration(log.timeToFirstToken)}</div>
										</>
									)}
								{log.timeToFirstReasoningToken !== null &&
									log.timeToFirstReasoningToken !== undefined && (
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
								{log.reasoningTokens && Number(log.reasoningTokens) > 0 && (
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

					{/* Cost + Metadata */}
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-3">
							<h4 className="text-sm font-medium">Cost Information</h4>
							<div className="rounded-md border p-3 space-y-3">
								<div>
									<p className="text-xs text-muted-foreground mb-2">
										Provider pricing
										{log.usedMode === "api-keys" &&
											(isUserFacing
												? " — not deducted from your balance"
												: " — not deducted from balance")}
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
										{!!log.videoOutputCost &&
											Number(log.videoOutputCost) > 0 && (
												<>
													<div>Video Output Cost</div>
													<div>{`$${Number(log.videoOutputCost).toFixed(8)}`}</div>
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
										{isUserFacing
											? "Billed to your organization"
											: "Billed to organization"}
									</p>
									<div className="grid grid-cols-2 gap-2 text-sm">
										<div className="text-muted-foreground">Data Storage</div>
										<div className="font-medium">
											{log.dataStorageCost
												? `$${Number(log.dataStorageCost).toFixed(8)}`
												: "$0"}
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
									{format(new Date(log.createdAt), "dd.MM.yyyy HH:mm:ss")}
								</div>
								<div className="text-muted-foreground">Request ID</div>
								<div className="flex items-center gap-1 font-mono text-xs break-all">
									<span>{log.requestId ?? "—"}</span>
									{showCopyButtons && log.requestId && (
										<button
											className="text-muted-foreground hover:text-foreground"
											onClick={() => copyToClipboard(log.requestId!)}
										>
											<Copy className="h-3 w-3" />
										</button>
									)}
								</div>
								{showLogId && (
									<>
										<div className="text-muted-foreground">Log ID</div>
										<div className="flex items-center gap-1 font-mono text-xs break-all">
											<span>{log.id}</span>
											{showCopyButtons && (
												<button
													className="text-muted-foreground hover:text-foreground"
													onClick={() => copyToClipboard(log.id)}
												>
													<Copy className="h-3 w-3" />
												</button>
											)}
										</div>
									</>
								)}
								<div className="text-muted-foreground">Source</div>
								<div className="font-mono text-xs break-all">
									{log.source ?? "-"}
								</div>
								<div className="text-muted-foreground">Project ID</div>
								<div className="flex items-center gap-1 font-mono text-xs break-all">
									<span>{log.projectId}</span>
									{showCopyButtons && log.projectId && (
										<button
											className="text-muted-foreground hover:text-foreground"
											onClick={() => copyToClipboard(log.projectId!)}
										>
											<Copy className="h-3 w-3" />
										</button>
									)}
								</div>
								<div className="text-muted-foreground">Organization ID</div>
								<div className="flex items-center gap-1 font-mono text-xs break-all">
									<span>{log.organizationId}</span>
									{showCopyButtons && log.organizationId && (
										<button
											className="text-muted-foreground hover:text-foreground"
											onClick={() => copyToClipboard(log.organizationId!)}
										>
											<Copy className="h-3 w-3" />
										</button>
									)}
								</div>
								<div className="text-muted-foreground">API Key ID</div>
								<div className="flex items-center gap-1 font-mono text-xs break-all">
									<span>{log.apiKeyId}</span>
									{showCopyButtons && log.apiKeyId && (
										<button
											className="text-muted-foreground hover:text-foreground"
											onClick={() => copyToClipboard(log.apiKeyId!)}
										>
											<Copy className="h-3 w-3" />
										</button>
									)}
								</div>
								<div className="text-muted-foreground">Mode</div>
								<div>{log.mode ?? "?"}</div>
								<div className="text-muted-foreground">Used Mode</div>
								<div>{log.usedMode ?? "?"}</div>
							</div>
							{customHeaders && Object.keys(customHeaders).length > 0 && (
								<div className="mt-3">
									<h5 className="text-xs font-medium text-muted-foreground mb-2">
										Custom Headers
									</h5>
									<div className="rounded-md border p-3">
										<div className="grid grid-cols-2 gap-2 text-sm">
											{Object.entries(customHeaders).map(([key, value]) => (
												<div key={key} className="contents">
													<div className="text-muted-foreground font-mono text-xs">
														{key}
													</div>
													<div className="font-mono text-xs break-words">
														{String(value)}
													</div>
												</div>
											))}
										</div>
									</div>
								</div>
							)}
						</div>
					</div>

					{/* Model Parameters */}
					<div className="space-y-2">
						<h4 className="text-sm font-medium">Model Parameters</h4>
						<div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-2 md:grid-cols-4">
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
											Alternative to temperature, controls diversity via nucleus
											sampling
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
								<span>{log.reasoningEffort ?? "-"}</span>
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
									{responseFormat
										? typeof responseFormat === "object"
											? (responseFormat.type ?? "-")
											: "-"
										: "-"}
								</span>
							</div>
							{imageConfig?.aspect_ratio && (
								<div className="flex items-center justify-between gap-2">
									<span className="text-muted-foreground">Aspect Ratio</span>
									<span>{String(imageConfig.aspect_ratio)}</span>
								</div>
							)}
							{imageConfig?.image_size && (
								<div className="flex items-center justify-between gap-2">
									<span className="text-muted-foreground">Image Size</span>
									<span>{String(imageConfig.image_size)}</span>
								</div>
							)}
							{imageConfig?.image_quality && (
								<div className="flex items-center justify-between gap-2">
									<span className="text-muted-foreground">Image Quality</span>
									<span>{String(imageConfig.image_quality)}</span>
								</div>
							)}
							{imageConfig?.n !== undefined && imageConfig.n !== null && (
								<div className="flex items-center justify-between gap-2">
									<span className="text-muted-foreground">Image Count</span>
									<span>{String(imageConfig.n)}</span>
								</div>
							)}
							{imageConfig?.output_format && (
								<div className="flex items-center justify-between gap-2">
									<span className="text-muted-foreground">Output Format</span>
									<span>{String(imageConfig.output_format)}</span>
								</div>
							)}
							{imageConfig?.output_compression !== undefined &&
								imageConfig.output_compression !== null && (
									<div className="flex items-center justify-between gap-2">
										<span className="text-muted-foreground">Compression</span>
										<span>{String(imageConfig.output_compression)}</span>
									</div>
								)}
							{imageConfig?.seed !== undefined && imageConfig.seed !== null && (
								<div className="flex items-center justify-between gap-2">
									<span className="text-muted-foreground">Seed</span>
									<span>{String(imageConfig.seed)}</span>
								</div>
							)}
						</div>
					</div>

					{/* Plugins */}
					{log.plugins && log.plugins.length > 0 && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Plugins</h4>
							<div className="rounded-md border p-3 text-sm space-y-3">
								<div className="flex flex-wrap gap-2">
									{log.plugins.map((plugin: string) => (
										<Badge key={plugin} variant="secondary" className="gap-1">
											<Plug className="h-3 w-3" />
											{plugin}
										</Badge>
									))}
								</div>
								{pluginResults && (
									<div className="space-y-2 pt-2 border-t">
										<h5 className="text-xs font-medium text-muted-foreground">
											Plugin Results
										</h5>
										{pluginResults.responseHealing && (
											<div className="flex items-center gap-2 text-xs">
												<Sparkles
													className={`h-3.5 w-3.5 ${
														pluginResults.responseHealing.healed
															? "text-green-500"
															: "text-muted-foreground"
													}`}
												/>
												<span>
													Response Healing:{" "}
													{pluginResults.responseHealing.healed ? (
														<span className="text-green-600 font-medium">
															Applied
															{pluginResults.responseHealing.healingMethod && (
																<span className="text-muted-foreground font-normal">
																	{" "}
																	(
																	{pluginResults.responseHealing.healingMethod
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

					{/* Additional Parameters */}
					{remainingParams && Object.keys(remainingParams).length > 0 && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Additional Parameters</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
								{renderParams(remainingParams)}
							</div>
						</div>
					)}

					{/* Tool Information */}
					{(tools ?? toolChoice ?? toolResults) && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Tool Information</h4>
							<div className="grid gap-4 md:grid-cols-1">
								{tools && (
									<div className="space-y-2">
										<h5 className="text-xs font-medium text-muted-foreground">
											Available Tools
										</h5>
										<div className="rounded-md border p-3">
											<pre className="max-h-40 text-xs overflow-auto whitespace-pre-wrap break-all">
												{JSON.stringify(tools, null, 2)}
											</pre>
										</div>
									</div>
								)}
								{toolChoice && (
									<div className="space-y-2">
										<h5 className="text-xs font-medium text-muted-foreground">
											Tool Choice
										</h5>
										<div className="rounded-md border p-3">
											<pre className="max-h-40 text-xs overflow-auto whitespace-pre-wrap break-all">
												{JSON.stringify(toolChoice, null, 2)}
											</pre>
										</div>
									</div>
								)}
								{toolResults && (
									<div className="space-y-2">
										<h5 className="text-xs font-medium text-muted-foreground">
											Tool Calls
										</h5>
										<div className="space-y-2">
											{Array.isArray(toolResults) ? (
												toolResults
													.filter(
														(tc): tc is NonNullable<typeof tc> =>
															tc !== null && tc !== undefined,
													)
													.map((toolCall, index) => (
														<div
															key={index}
															className="rounded-md border p-3 overflow-scroll"
														>
															<div className="grid gap-2 text-xs">
																<div className="flex justify-between">
																	<span className="font-medium">
																		{toolCall.function?.name ??
																			"Unknown Function"}
																	</span>
																	<span className="text-muted-foreground">
																		ID: {toolCall.id ?? "N/A"}
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
													<pre className="max-h-40 text-xs overflow-auto whitespace-pre-wrap break-all">
														{JSON.stringify(toolResults, null, 2)}
													</pre>
												</div>
											)}
										</div>
									</div>
								)}
							</div>
						</div>
					)}

					{/* Builtin Tools (Web Search) */}
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

					{/* Error Details */}
					{log.hasError && !!errorDetails && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium text-red-600">
								Error Details
							</h4>
							<div className="grid grid-cols-2 gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 p-3 text-sm">
								<div className="text-red-600">Status Code</div>
								<div className="font-medium">{errorDetails.statusCode}</div>
								<div className="text-red-600">Status Text</div>
								<div className="font-medium">{errorDetails.statusText}</div>
								<div className="text-red-600 col-span-2">Error Message</div>
								<div className="col-span-2 rounded bg-white dark:bg-gray-900 text-black dark:text-gray-100 p-2 text-xs">
									{errorDetails.responseText}
								</div>
							</div>
							{log.retried && log.retriedByLogId && (
								<div className="flex items-center gap-2 rounded-md border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-3 text-sm">
									<RefreshCw className="h-4 w-4 text-amber-600" />
									<span className="text-amber-800">
										This request was retried and succeeded.
									</span>
									{getRetriedUrl ? (
										<LinkComponent
											href={getRetriedUrl(log.retriedByLogId)}
											className="text-amber-600 underline hover:text-amber-800 ml-auto"
										>
											View successful request
										</LinkComponent>
									) : (
										<span className="text-amber-600 ml-auto font-mono text-xs">
											{log.retriedByLogId}
										</span>
									)}
								</div>
							)}
						</div>
					)}

					{/* Message Context */}
					<div className="space-y-2">
						<h4 className="text-sm font-medium">Message Context</h4>
						<div className="rounded-md border p-3">
							{messages ? (
								<pre className="max-h-60 text-xs overflow-auto whitespace-pre-wrap break-all">
									{JSON.stringify(
										messages,
										(_key, value) => {
											if (
												typeof value === "string" &&
												value.length > 200 &&
												/[A-Za-z0-9+/]{200,}/.test(value)
											) {
												return "[base64 image data truncated]";
											}
											return value;
										},
										2,
									)}
								</pre>
							) : !retentionEnabled && isUserFacing ? (
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
						{!!responseFormat && (
							<div className="mt-3">
								<h5 className="text-xs font-medium text-muted-foreground mb-2">
									Response Format
								</h5>
								<div className="rounded-md border p-3">
									<pre className="max-h-40 text-xs overflow-auto whitespace-pre-wrap break-all">
										{JSON.stringify(responseFormat, null, 2)}
									</pre>
								</div>
							</div>
						)}
					</div>

					{/* Reasoning Content */}
					{log.reasoningContent && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium">Reasoning Content</h4>
							<div className="rounded-md border p-3">
								<pre className="max-h-60 text-xs overflow-auto whitespace-pre-wrap break-all">
									{log.reasoningContent}
								</pre>
							</div>
						</div>
					)}

					{/* Response */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<h4 className="text-sm font-medium">Response</h4>
							{log.content === "[image_generated]" && fetchImageContent && (
								<Button
									variant="outline"
									size="sm"
									className="h-7 gap-1.5 text-xs"
									disabled={imagePreviewLoading}
									onClick={async () => {
										setImagePreviewLoading(true);
										try {
											const content = await fetchImageContent(log.id);
											if (content) {
												// Extract all data URLs from the content
												const dataUrlRegex =
													/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
												const matches = content.match(dataUrlRegex);
												if (matches && matches.length > 0) {
													setImagePreviewSrcs(matches);
												} else if (content.startsWith("data:")) {
													setImagePreviewSrcs([content]);
												} else {
													const fmt = imageConfig?.output_format
														? String(imageConfig.output_format).toLowerCase()
														: "png";
													const mime = `image/${fmt === "jpg" ? "jpeg" : fmt}`;
													setImagePreviewSrcs([
														`data:${mime};base64,${content}`,
													]);
												}
												setImagePreviewOpen(true);
											}
										} finally {
											setImagePreviewLoading(false);
										}
									}}
								>
									{imagePreviewLoading ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<Eye className="h-3.5 w-3.5" />
									)}
									Preview Image
								</Button>
							)}
						</div>
						<div className="rounded-md border p-3">
							{log.content === "[image_generated]" ? (
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<Sparkles className="h-4 w-4" />
									<span>Image generated.</span>
									{detailUrl && (
										<LinkComponent
											href={detailUrl}
											className="text-blue-600 dark:text-blue-400 hover:underline"
										>
											View image
										</LinkComponent>
									)}
								</div>
							) : log.content ? (
								<pre className="max-h-60 text-xs overflow-auto whitespace-pre-wrap break-all">
									{log.content}
								</pre>
							) : !retentionEnabled && isUserFacing ? (
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

			{/* Image Preview Dialog */}
			<Dialog open={imagePreviewOpen} onOpenChange={setImagePreviewOpen}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							Generated Image{imagePreviewSrcs.length > 1 ? "s" : ""}
						</DialogTitle>
						<DialogDescription>
							Preview of the generated image
							{imagePreviewSrcs.length > 1 ? "s" : ""} from this request.
						</DialogDescription>
					</DialogHeader>
					{imagePreviewSrcs.length > 0 && (
						<div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
							{imagePreviewSrcs.map((src, i) => (
								<div key={i} className="rounded-md border overflow-hidden">
									<img
										src={src}
										alt={`Generated image ${i + 1}`}
										className="w-full h-auto"
									/>
								</div>
							))}
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
