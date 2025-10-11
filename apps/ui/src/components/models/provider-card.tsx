"use client";

import { Copy, Check, AlertTriangle } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";
import { getProviderIcon } from "@/lib/components/providers-icons";
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

				<div className="grid grid-cols-3 gap-4 text-sm">
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
			</CardContent>
		</Card>
	);
}
