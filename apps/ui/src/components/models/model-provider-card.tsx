"use client";

import {
	Copy,
	Check,
	AlertTriangle,
	Zap,
	Eye,
	Wrench,
	MessageSquare,
	Braces,
	Play,
	Share2,
	Linkedin,
	Globe,
} from "lucide-react";
import { useState } from "react";

import { ModelCodeExampleDialog } from "@/components/models/model-code-example-dialog";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { useAppConfig } from "@/lib/config";
import { XIcon } from "@/lib/icons/XIcon";
import { formatContextSize } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared/components";

import type {
	ProviderModelMapping,
	ProviderDefinition,
	StabilityLevel,
} from "@llmgateway/models";

interface ProviderWithInfo extends ProviderModelMapping {
	providerInfo?: ProviderDefinition;
}

interface ModelProviderCardProps {
	provider: ProviderWithInfo;
	modelName: string;
	modelStability?: StabilityLevel;
}

export function ModelProviderCard({
	provider,
	modelName,
	modelStability,
}: ModelProviderCardProps) {
	const config = useAppConfig();
	const [copied, setCopied] = useState(false);
	const [urlCopied, setUrlCopied] = useState(false);
	const providerModelName = `${provider.providerId}/${modelName}`;
	const ProviderIcon = getProviderIcon(provider.providerId);
	const providerStability = provider.stability || modelStability;

	const shareUrl = `${config.appUrl}/models/${encodeURIComponent(modelName)}/${encodeURIComponent(provider.providerId)}`;
	const shareTitle = `${provider.providerInfo?.name || provider.providerId} - ${modelName} on LLM Gateway`;

	const getStabilityBadgeProps = (stability?: StabilityLevel) => {
		switch (stability) {
			case "beta":
				return {
					variant: "secondary" as const,
					color: "text-blue-600",
					label: "BETA",
				};
			case "unstable":
				return {
					variant: "destructive" as const,
					color: "text-red-600",
					label: "UNSTABLE",
				};
			case "experimental":
				return {
					variant: "destructive" as const,
					color: "text-orange-600",
					label: "EXPERIMENTAL",
				};
			default:
				return null;
		}
	};

	const shouldShowStabilityWarning = (stability?: StabilityLevel) => {
		return stability && ["unstable", "experimental"].includes(stability);
	};

	const copyToClipboard = async () => {
		try {
			await navigator.clipboard.writeText(providerModelName);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error("Failed to copy:", err);
		}
	};

	const formatPrice = (price?: number) => {
		if (price === undefined) {
			return "—";
		}
		return `$${(price * 1e6).toFixed(2)}`;
	};

	return (
		<Card>
			<CardContent>
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-3">
						<div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
							{ProviderIcon ? (
								<ProviderIcon className="h-10 w-10" />
							) : (
								provider.providerInfo?.name?.charAt(0) || "?"
							)}
						</div>
						<div>
							<div className="flex items-center gap-2 mb-1">
								<h3 className="font-semibold">
									{provider.providerInfo?.name || provider.providerId}
								</h3>
								{shouldShowStabilityWarning(providerStability) && (
									<AlertTriangle className="h-4 w-4 text-orange-500" />
								)}
								{(() => {
									const stabilityProps =
										getStabilityBadgeProps(providerStability);
									return stabilityProps ? (
										<Badge
											variant={stabilityProps.variant}
											className="text-xs px-2 py-0.5"
										>
											{stabilityProps.label}
										</Badge>
									) : null;
								})()}
							</div>
							<div className="flex items-center gap-2">
								<code className="text-xs bg-muted px-2 py-1 rounded font-mono">
									{providerModelName}
								</code>
								<div className="flex items-center gap-1">
									<Button
										variant="ghost"
										size="sm"
										onClick={copyToClipboard}
										className="h-5 w-5 p-0"
										type="button"
										aria-label="Copy model id"
									>
										{copied ? (
											<Check className="h-3 w-3 text-green-600" />
										) : (
											<Copy className="h-3 w-3" />
										)}
									</Button>
									<div className="hidden sm:block">
										<ModelCodeExampleDialog modelId={providerModelName} />
									</div>
								</div>
							</div>
						</div>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="sm" className="h-8 w-8 p-0">
								<Share2 className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								onClick={async () => {
									await navigator.clipboard.writeText(shareUrl);
									setUrlCopied(true);
									setTimeout(() => setUrlCopied(false), 2000);
								}}
								className="cursor-pointer"
							>
								{urlCopied ? (
									<Check className="h-4 w-4 mr-2 text-green-500" />
								) : (
									<Copy className="h-4 w-4 mr-2" />
								)}
								{urlCopied ? "Copied!" : "Copy URL"}
							</DropdownMenuItem>
							<DropdownMenuItem asChild className="cursor-pointer">
								<a
									href={`https://x.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`}
									target="_blank"
									rel="noopener noreferrer"
								>
									<XIcon className="h-4 w-4 mr-2" />
									Share on X
								</a>
							</DropdownMenuItem>
							<DropdownMenuItem asChild className="cursor-pointer">
								<a
									href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
									target="_blank"
									rel="noopener noreferrer"
								>
									<Linkedin className="h-4 w-4 mr-2" />
									Share on LinkedIn
								</a>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<div className="grid grid-cols-2 gap-4 text-sm mb-4">
					<div>
						<div className="text-muted-foreground mb-1">Context Size</div>
						<div className="font-mono text-lg font-bold">
							{provider.contextSize
								? formatContextSize(provider.contextSize)
								: "—"}
						</div>
					</div>
					<div>
						<div className="text-muted-foreground mb-1">Stability</div>
						<Badge className="text-xs px-2 py-0.5 font-semibold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
							{provider.stability || "STABLE"}
						</Badge>
					</div>
				</div>

				<div className="mb-4">
					<div className="text-muted-foreground text-sm mb-2">Pricing</div>
					<div className="grid grid-cols-3 gap-3">
						<div>
							<div className="text-muted-foreground text-xs mb-1">Input</div>
							<div className="font-mono">
								{provider.inputPrice ? (
									<div className="space-y-1">
										<div className="flex items-center gap-2">
											{provider.discount ? (
												<>
													<span className="line-through text-muted-foreground text-xs">
														{formatPrice(provider.inputPrice)}
													</span>
													<span className="text-green-600 font-semibold">
														{formatPrice(
															provider.inputPrice * (1 - provider.discount),
														)}
													</span>
												</>
											) : (
												formatPrice(provider.inputPrice)
											)}
										</div>
										<span className="text-muted-foreground text-xs">/M</span>
									</div>
								) : (
									"—"
								)}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground text-xs mb-1">Cached</div>
							<div className="font-mono">
								{provider.cachedInputPrice ? (
									<div className="space-y-1">
										<div className="flex items-center gap-2">
											{provider.discount ? (
												<>
													<span className="line-through text-muted-foreground text-xs">
														{formatPrice(provider.cachedInputPrice)}
													</span>
													<span className="text-green-600 font-semibold">
														{formatPrice(
															provider.cachedInputPrice *
																(1 - provider.discount),
														)}
													</span>
												</>
											) : (
												formatPrice(provider.cachedInputPrice)
											)}
										</div>
										<span className="text-muted-foreground text-xs">/M</span>
									</div>
								) : (
									"—"
								)}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground text-xs mb-1">Output</div>
							<div className="font-mono">
								{provider.outputPrice ? (
									<div className="space-y-1">
										<div className="flex items-center gap-2">
											{provider.discount ? (
												<>
													<span className="line-through text-muted-foreground text-xs">
														{formatPrice(provider.outputPrice)}
													</span>
													<span className="text-green-600 font-semibold">
														{formatPrice(
															provider.outputPrice * (1 - provider.discount),
														)}
													</span>
												</>
											) : (
												formatPrice(provider.outputPrice)
											)}
										</div>
										<span className="text-muted-foreground text-xs">/M</span>
									</div>
								) : (
									"—"
								)}
							</div>
						</div>
					</div>
					{provider.imageOutputPrice !== undefined && (
						<div className="grid grid-cols-3 gap-3 mt-3">
							<div className="col-span-3">
								<div className="text-muted-foreground text-xs mb-1">
									Image Output
								</div>
								<div className="font-mono">
									<div className="space-y-1">
										<div className="flex items-center gap-2">
											{provider.discount ? (
												<>
													<span className="line-through text-muted-foreground text-xs">
														{formatPrice(provider.imageOutputPrice)}
													</span>
													<span className="text-green-600 font-semibold">
														{formatPrice(
															provider.imageOutputPrice *
																(1 - provider.discount),
														)}
													</span>
												</>
											) : (
												formatPrice(provider.imageOutputPrice)
											)}
										</div>
										<span className="text-muted-foreground text-xs">/M</span>
									</div>
								</div>
							</div>
						</div>
					)}
					{provider.requestPrice !== undefined && provider.requestPrice > 0 && (
						<div className="grid grid-cols-3 gap-3 mt-3">
							<div className="col-span-3">
								<div className="text-muted-foreground text-xs mb-1">
									Per Request
								</div>
								<div className="font-mono">
									<div className="space-y-1">
										<div className="flex items-center gap-2">
											{provider.discount ? (
												<>
													<span className="line-through text-muted-foreground text-xs">
														${provider.requestPrice.toFixed(3)}
													</span>
													<span className="text-green-600 font-semibold">
														$
														{(
															provider.requestPrice *
															(1 - provider.discount)
														).toFixed(3)}
													</span>
												</>
											) : (
												<>${provider.requestPrice.toFixed(3)}</>
											)}
										</div>
										<span className="text-muted-foreground text-xs">/req</span>
									</div>
								</div>
							</div>
						</div>
					)}
					{provider.discount && (
						<div className="mt-2">
							<Badge
								variant="secondary"
								className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 border-green-200"
							>
								-{(provider.discount * 100).toFixed(0)}% off
							</Badge>
						</div>
					)}
					{provider.pricingTiers && provider.pricingTiers.length > 1 && (
						<div className="mt-3 pt-3 border-t">
							<div className="text-muted-foreground text-xs mb-2">
								Tiered Pricing
							</div>
							<div className="space-y-2">
								{provider.pricingTiers.map((tier, index) => (
									<div
										key={index}
										className="flex justify-between items-center text-xs"
									>
										<span className="text-muted-foreground">
											{tier.upToTokens === Infinity
												? `>${(provider.pricingTiers![index - 1]?.upToTokens || 0) / 1000}K tokens`
												: `≤${tier.upToTokens / 1000}K tokens`}
										</span>
										{provider.discount ? (
											<span className="font-mono">
												<span className="line-through text-muted-foreground">
													{formatPrice(tier.inputPrice)} in /{" "}
													{tier.cachedInputPrice !== null &&
														tier.cachedInputPrice !== undefined && (
															<>
																{formatPrice(tier.cachedInputPrice)} cached
																/{" "}
															</>
														)}
													{formatPrice(tier.outputPrice)} out
												</span>
												<span className="text-green-600 font-semibold ml-2">
													{formatPrice(
														tier.inputPrice * (1 - provider.discount),
													)}{" "}
													in /{" "}
													{tier.cachedInputPrice !== null &&
														tier.cachedInputPrice !== undefined && (
															<>
																{formatPrice(
																	tier.cachedInputPrice *
																		(1 - provider.discount),
																)}{" "}
																cached /{" "}
															</>
														)}
													{formatPrice(
														tier.outputPrice * (1 - provider.discount),
													)}{" "}
													out
												</span>
											</span>
										) : (
											<span className="font-mono">
												{formatPrice(tier.inputPrice)} in /{" "}
												{tier.cachedInputPrice !== null &&
													tier.cachedInputPrice !== undefined && (
														<>{formatPrice(tier.cachedInputPrice)} cached / </>
													)}
												{formatPrice(tier.outputPrice)} out
											</span>
										)}
									</div>
								))}
							</div>
						</div>
					)}
				</div>

				<div className="border-t pt-4 mb-4">
					<div className="text-muted-foreground text-sm mb-2">Capabilities</div>
					<TooltipProvider delayDuration={300}>
						<div className="flex flex-wrap gap-2">
							{provider.streaming && (
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-xs">
											<Zap className="h-3.5 w-3.5" />
											<span>Streaming</span>
										</div>
									</TooltipTrigger>
									<TooltipContent>
										<p>Supports streaming responses</p>
									</TooltipContent>
								</Tooltip>
							)}
							{provider.vision && (
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 text-xs">
											<Eye className="h-3.5 w-3.5" />
											<span>Vision</span>
										</div>
									</TooltipTrigger>
									<TooltipContent>
										<p>Supports vision and image inputs</p>
									</TooltipContent>
								</Tooltip>
							)}
							{provider.tools && (
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 text-xs">
											<Wrench className="h-3.5 w-3.5" />
											<span>Tools</span>
										</div>
									</TooltipTrigger>
									<TooltipContent>
										<p>Supports function calling and tools</p>
									</TooltipContent>
								</Tooltip>
							)}
							{provider.reasoning && (
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 text-xs">
											<MessageSquare className="h-3.5 w-3.5" />
											<span>Reasoning</span>
										</div>
									</TooltipTrigger>
									<TooltipContent>
										<p>Supports extended reasoning</p>
									</TooltipContent>
								</Tooltip>
							)}
							{provider.jsonOutput && (
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-300 text-xs">
											<Braces className="h-3.5 w-3.5" />
											<span>JSON Output</span>
										</div>
									</TooltipTrigger>
									<TooltipContent>
										<p>Supports structured JSON output</p>
									</TooltipContent>
								</Tooltip>
							)}
							{provider.webSearch && (
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 text-xs">
											<Globe className="h-3.5 w-3.5" />
											<span>Native Web Search</span>
										</div>
									</TooltipTrigger>
									<TooltipContent>
										<p>
											Supports native web search
											{provider.webSearchPrice
												? ` ($${provider.webSearchPrice.toFixed(3)}/search)`
												: ""}
										</p>
									</TooltipContent>
								</Tooltip>
							)}
						</div>
					</TooltipProvider>
				</div>

				<Button
					variant="default"
					size="default"
					className="w-full gap-2 font-semibold"
					asChild
				>
					<a
						href={`${config.playgroundUrl}?model=${encodeURIComponent(providerModelName)}`}
						target="_blank"
						rel="noopener noreferrer"
					>
						<Play className="h-4 w-4" />
						Try in Playground
					</a>
				</Button>
			</CardContent>
		</Card>
	);
}
