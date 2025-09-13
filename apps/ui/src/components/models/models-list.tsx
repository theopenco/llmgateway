"use client";

import { AlertTriangle } from "lucide-react";

import { Badge } from "@/lib/components/badge";
import { Card } from "@/lib/components/card";
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

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{(models as readonly ModelDefinition[]).map((model) => (
				<Card key={model.id} className="p-4">
					<div className="text-lg font-semibold flex items-center gap-2">
						{model.name || model.id}
						{shouldShowStabilityWarning(model.stability) && (
							<AlertTriangle className="h-4 w-4 text-orange-500" />
						)}
					</div>
					<div className="text-sm text-muted-foreground mb-2">Providers:</div>
					<div className="flex flex-wrap gap-2 mb-2">
						{model.providers.map((provider) => {
							const providerStability = provider.stability || model.stability;
							const stabilityProps = getStabilityBadgeProps(providerStability);

							return (
								<div
									key={provider.providerId}
									className="flex items-center gap-1"
								>
									<Badge>{provider.providerId}</Badge>
									{stabilityProps && (
										<Badge
											variant={stabilityProps.variant}
											className="text-xs px-1 py-0.5"
										>
											{stabilityProps.label}
										</Badge>
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
							<div key={provider.providerId} className="mt-2">
								<div className="font-medium">{provider.providerId}:</div>
								{provider.contextSize && (
									<div>Context: {formatContextSize(provider.contextSize)}</div>
								)}
								{provider.inputPrice !== undefined && (
									<div>
										Input: ${(provider.inputPrice * 1e6).toFixed(2)} / M tokens
									</div>
								)}
								{provider.outputPrice !== undefined && (
									<div>
										Output: ${(provider.outputPrice * 1e6).toFixed(2)} / M
										tokens
									</div>
								)}
								{provider.imageInputPrice !== undefined && (
									<div>
										Image: ${provider.imageInputPrice.toFixed(5)} / input
									</div>
								)}
								{provider.requestPrice !== undefined && (
									<div>
										Request: ${(provider.requestPrice * 1000).toFixed(2)} / 1K
										requests
									</div>
								)}
							</div>
						))}
					</div>
				</Card>
			))}
		</div>
	);
}
