"use client";

import { AlertTriangle } from "lucide-react";

import { Badge } from "@/lib/components/badge";
import { Card } from "@/lib/components/card";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { formatContextSize } from "@/lib/utils";

import { models } from "@llmgateway/models";

import type { ModelDefinition, StabilityLevel } from "@llmgateway/models";

export function ModelsList() {
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

	const now = new Date();

	const sortedModels = (models as readonly ModelDefinition[])
		.map((model) => {
			const hasDeactivatedProvider = model.providers.some(
				(provider) =>
					provider.deactivatedAt && new Date(provider.deactivatedAt) <= now,
			);
			return { model, hasDeactivatedProvider };
		})
		.sort((a, b) => {
			if (a.hasDeactivatedProvider && !b.hasDeactivatedProvider) {
				return 1;
			}
			if (!a.hasDeactivatedProvider && b.hasDeactivatedProvider) {
				return -1;
			}
			return 0;
		});

	return (
		<TooltipProvider>
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				{sortedModels.map(({ model, hasDeactivatedProvider }) => (
					<Card
						key={model.id}
						className={`p-4 ${hasDeactivatedProvider ? "opacity-50" : ""}`}
					>
						<div className="text-lg font-semibold flex items-center gap-2">
							{model.name ?? model.id}
							{shouldShowStabilityWarning(model.stability) && (
								<AlertTriangle className="h-4 w-4 text-orange-500" />
							)}
							{hasDeactivatedProvider && (
								<Badge variant="destructive" className="text-xs">
									DEACTIVATED
								</Badge>
							)}
						</div>
						<div className="text-sm text-muted-foreground mb-2">Providers:</div>
						<div className="flex flex-wrap gap-2 mb-2">
							{model.providers.map((provider) => {
								const providerStability = provider.stability ?? model.stability;
								const stabilityProps =
									getStabilityBadgeProps(providerStability);
								const isDeprecated =
									provider.deprecatedAt &&
									new Date(provider.deprecatedAt) <= now;
								const isDeactivated =
									provider.deactivatedAt &&
									new Date(provider.deactivatedAt) <= now;

								return (
									<div
										key={`${provider.providerId}-${provider.modelName}-${model.id}`}
										className="flex items-center gap-1"
									>
										<Badge
											className={isDeactivated ? "opacity-50 line-through" : ""}
										>
											{provider.providerId}
										</Badge>
										{stabilityProps && (
											<Badge
												variant={stabilityProps.variant}
												className="text-xs px-1 py-0.5"
											>
												{stabilityProps.label}
											</Badge>
										)}
										{isDeprecated && !isDeactivated && (
											<Tooltip>
												<TooltipTrigger>
													<Badge
														variant="outline"
														className="text-xs px-1 py-0.5 border-yellow-600 text-yellow-600 dark:border-yellow-500 dark:text-yellow-500"
													>
														DEPRECATED
													</Badge>
												</TooltipTrigger>
												<TooltipContent>
													<p>
														Deprecated on{" "}
														{new Date(
															provider.deprecatedAt as Date,
														).toLocaleDateString()}
													</p>
												</TooltipContent>
											</Tooltip>
										)}
									</div>
								);
							})}
						</div>
						<div className="flex items-center gap-2 mb-2">
							<span className="text-sm text-muted-foreground">Stability:</span>
							{(() => {
								const stabilityProps = getStabilityBadgeProps(model.stability);
								return stabilityProps ? (
									<Badge
										variant={stabilityProps.variant}
										className="text-xs px-2 py-1"
									>
										{stabilityProps.label}
									</Badge>
								) : (
									<Badge variant="outline" className="text-xs px-2 py-1">
										STABLE
									</Badge>
								);
							})()}
						</div>
						<div className="text-sm">
							{model.providers.map((provider) => (
								<div
									key={`${provider.providerId}-${provider.modelName}-${model.id}`}
									className="mt-2"
								>
									<div className="font-medium">{provider.providerId}:</div>
									{provider.contextSize && (
										<div>
											Context: {formatContextSize(provider.contextSize)}
										</div>
									)}
									{provider.inputPrice !== undefined && (
										<div>Input: ${provider.inputPrice * 1e6} / M tokens</div>
									)}
									{provider.outputPrice !== undefined && (
										<div>Output: ${provider.outputPrice * 1e6} / M tokens</div>
									)}
									{provider.imageInputPrice !== undefined && (
										<div>Image: ${provider.imageInputPrice} / input</div>
									)}
									{provider.imageOutputPrice !== undefined && (
										<div>
											Image Output: ${provider.imageOutputPrice * 1e6} / M
											tokens
										</div>
									)}
									{provider.requestPrice !== undefined &&
										provider.requestPrice > 0 && (
											<div>
												Request: ${provider.requestPrice * 1000} / 1K requests
											</div>
										)}
								</div>
							))}
						</div>
					</Card>
				))}
			</div>
		</TooltipProvider>
	);
}
