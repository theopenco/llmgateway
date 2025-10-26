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
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";
import { getProviderIcon } from "@/lib/components/providers-icons";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { formatContextSize } from "@/lib/utils";

import type {
	ProviderModelMapping,
	ProviderDefinition,
	StabilityLevel,
} from "@llmgateway/models";

interface ProviderWithInfo extends ProviderModelMapping {
	providerInfo?: ProviderDefinition;
}

interface ProviderCardProps {
	provider: ProviderWithInfo;
	modelName: string;
	modelStability?: StabilityLevel;
}

export function ProviderCard({
	provider,
	modelName,
	modelStability,
}: ProviderCardProps) {
	const [copied, setCopied] = useState(false);
	const providerModelName = `${provider.providerId}/${modelName}`;
	const ProviderIcon = getProviderIcon(provider.providerId);
	const providerStability = provider.stability || modelStability;

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

	return (
		<Card>
			<CardContent className="p-6">
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
								<Button
									variant="ghost"
									size="sm"
									onClick={copyToClipboard}
									className="h-5 w-5 p-0"
								>
									{copied ? (
										<Check className="h-3 w-3 text-green-600" />
									) : (
										<Copy className="h-3 w-3" />
									)}
								</Button>
							</div>
						</div>
					</div>
				</div>

				<div className="grid grid-cols-3 gap-4 text-sm mb-4">
					<div>
						<div className="text-muted-foreground mb-1">Context</div>
						<div className="font-mono">
							{provider.contextSize
								? formatContextSize(provider.contextSize)
								: "—"}
						</div>
					</div>
					<div>
						<div className="text-muted-foreground mb-1">Input</div>
						<div className="font-mono">
							{provider.inputPrice ? (
								<div className="space-y-1">
									<div className="flex items-center gap-2">
										{provider.discount ? (
											<>
												<span className="line-through text-muted-foreground text-xs">
													${(provider.inputPrice * 1e6).toFixed(2)}
												</span>
												<span className="text-green-600 font-semibold">
													$
													{(
														provider.inputPrice *
														1e6 *
														(1 - provider.discount)
													).toFixed(2)}
												</span>
											</>
										) : (
											`$${(provider.inputPrice * 1e6).toFixed(2)}`
										)}
									</div>
									{provider.discount && (
										<Badge
											variant="secondary"
											className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 border-green-200"
										>
											-{(provider.discount * 100).toFixed(0)}% off
										</Badge>
									)}
								</div>
							) : (
								"—"
							)}
						</div>
					</div>
					<div>
						<div className="text-muted-foreground mb-1">Output</div>
						<div className="font-mono">
							{provider.outputPrice ? (
								<div className="space-y-1">
									<div className="flex items-center gap-2">
										{provider.discount ? (
											<>
												<span className="line-through text-muted-foreground text-xs">
													${(provider.outputPrice * 1e6).toFixed(2)}
												</span>
												<span className="text-green-600 font-semibold">
													$
													{(
														provider.outputPrice *
														1e6 *
														(1 - provider.discount)
													).toFixed(2)}
												</span>
											</>
										) : (
											`$${(provider.outputPrice * 1e6).toFixed(2)}`
										)}
									</div>
									{provider.discount && (
										<Badge
											variant="secondary"
											className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 border-green-200"
										>
											-{(provider.discount * 100).toFixed(0)}% off
										</Badge>
									)}
								</div>
							) : (
								"—"
							)}
						</div>
					</div>
				</div>

				<div className="border-t pt-4">
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
						</div>
					</TooltipProvider>
				</div>
			</CardContent>
		</Card>
	);
}
