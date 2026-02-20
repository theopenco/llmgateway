"use client";

import { AlertTriangle, Copy, Check, Play } from "lucide-react";
import { useState } from "react";

import { ModelCodeExampleDialog } from "@/components/models/model-code-example-dialog";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";
import { TooltipProvider } from "@/lib/components/tooltip";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { useAppConfig } from "@/lib/config";
import { formatContextSize } from "@/lib/utils";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "@/lib/fetch-models";
import type { StabilityLevel } from "@llmgateway/models";
import type { LucideProps } from "lucide-react";

interface ModelWithProviders extends ApiModel {
	providerDetails: Array<{
		provider: ApiModelProviderMapping;
		providerInfo: ApiProvider;
	}>;
}

const getStabilityClassName = (stability?: StabilityLevel | null): string => {
	const level = stability ?? "stable";
	switch (level) {
		case "stable":
			return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
		case "experimental":
			return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
		case "unstable":
			return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
		case "beta":
			return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
		default:
			return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
	}
};

export function ProviderModelCard({
	model,
	shouldShowStabilityWarning,
	getCapabilityIcons,
	goToModel,
	formatPrice,
}: {
	model: ModelWithProviders;
	getCapabilityIcons: (
		provider: ApiModelProviderMapping,
		model?: ApiModel,
	) => {
		icon: React.ForwardRefExoticComponent<
			Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
		>;
		label: string;
		color: string;
	}[];
	shouldShowStabilityWarning: (
		stability?: StabilityLevel | null,
	) => boolean | undefined;
	goToModel: () => void;
	formatPrice: (
		price: string | null | undefined,
		discount?: string | null,
	) => string | React.JSX.Element;
}) {
	const config = useAppConfig();
	const [copiedModel, setCopiedModel] = useState<string | null>(null);

	const copyToClipboard = (text: string) => {
		void navigator.clipboard.writeText(text);
		setCopiedModel(text);
		setTimeout(() => setCopiedModel(null), 2000);
	};

	const provider = model.providerDetails[0].provider;
	const providerModelId = `${provider.providerId}/${model.id}`;

	return (
		<TooltipProvider>
			<Card
				className="group relative overflow-hidden border bg-background hover:bg-muted/50 transition-all duration-300 py-0.5"
				onClick={goToModel}
			>
				<div className="p-4 space-y-4">
					<div className="space-y-3">
						<div className="flex items-start justify-between gap-4">
							<h3 className="text-2xl font-bold text-foreground tracking-tight">
								{model.name ?? model.id}
							</h3>
							<div
								onClick={(e) => e.stopPropagation()}
								onMouseDown={(e) => e.stopPropagation()}
							>
								<ModelCodeExampleDialog modelId={providerModelId} />
							</div>
							{shouldShowStabilityWarning(model.stability) && (
								<AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
							)}
						</div>
						<Badge
							variant="secondary"
							className="text-xs font-medium bg-muted text-muted-foreground border hover:bg-muted/80"
						>
							{model.family}
						</Badge>
					</div>

					<div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted border">
						<code className="text-sm font-mono text-muted-foreground flex-1 truncate">
							{providerModelId}
						</code>
						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="sm"
								className="h-8 w-8 p-0 shrink-0 hover:bg-muted text-muted-foreground hover:text-foreground"
								onClick={(e) => {
									e.stopPropagation();
									copyToClipboard(providerModelId);
								}}
								title="Copy model ID"
							>
								{copiedModel === providerModelId ? (
									<Check className="h-4 w-4 text-green-400" />
								) : (
									<Copy className="h-4 w-4" />
								)}
							</Button>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div>
							<div className="text-xs text-muted-foreground mb-1">
								Context Size
							</div>
							<div className="text-lg font-bold text-foreground">
								{provider.contextSize
									? formatContextSize(provider.contextSize)
									: "—"}
							</div>
						</div>

						<div>
							<div className="text-xs text-muted-foreground mb-1">
								Stability
							</div>
							<Badge
								className={`text-xs px-2 py-0.5 font-semibold border ${getStabilityClassName(provider.stability)}`}
							>
								{provider.stability ?? "STABLE"}
							</Badge>
						</div>
					</div>

					<div>
						<div className="text-xs text-muted-foreground mb-2">Pricing</div>
						<div className="grid grid-cols-3 gap-3">
							<div className="space-y-1">
								<div className="text-xs text-muted-foreground">Input</div>
								<div className="font-semibold text-foreground text-sm">
									{typeof formatPrice(
										provider.inputPrice,
										provider.discount,
									) === "string" ? (
										<>
											{formatPrice(provider.inputPrice, provider.discount)}
											<span className="text-muted-foreground text-xs ml-1">
												/M
											</span>
										</>
									) : (
										<span className="inline-flex items-baseline gap-1">
											{formatPrice(provider.inputPrice, provider.discount)}
											<span className="text-muted-foreground text-xs">/M</span>
										</span>
									)}
								</div>
							</div>
							<div className="space-y-1">
								<div className="text-xs text-muted-foreground">Cached</div>
								<div className="font-semibold text-foreground text-sm">
									{typeof formatPrice(
										provider.cachedInputPrice,
										provider.discount,
									) === "string" ? (
										<>
											{formatPrice(
												provider.cachedInputPrice,
												provider.discount,
											)}
											<span className="text-muted-foreground text-xs ml-1">
												/M
											</span>
										</>
									) : (
										<span className="inline-flex items-baseline gap-1">
											{formatPrice(
												provider.cachedInputPrice,
												provider.discount,
											)}
											<span className="text-muted-foreground text-xs">/M</span>
										</span>
									)}
								</div>
							</div>
							<div className="space-y-1">
								<div className="text-xs text-muted-foreground">Output</div>
								<div className="font-semibold text-foreground text-sm">
									{typeof formatPrice(
										provider.outputPrice,
										provider.discount,
									) === "string" ? (
										<>
											{formatPrice(provider.outputPrice, provider.discount)}
											<span className="text-muted-foreground text-xs ml-1">
												/M
											</span>
										</>
									) : (
										<span className="inline-flex items-baseline gap-1">
											{formatPrice(provider.outputPrice, provider.discount)}
											<span className="text-muted-foreground text-xs">/M</span>
										</span>
									)}
								</div>
							</div>
							{provider.requestPrice !== null &&
								provider.requestPrice !== undefined &&
								parseFloat(provider.requestPrice) > 0 && (
									<div className="space-y-1">
										<div className="text-xs text-muted-foreground">
											Per Request
										</div>
										<div className="font-semibold text-foreground text-sm">
											${parseFloat(provider.requestPrice).toFixed(3)}
											<span className="text-muted-foreground text-xs ml-1">
												/req
											</span>
										</div>
									</div>
								)}
						</div>
					</div>

					<div>
						<div className="text-xs text-muted-foreground mb-2">
							Capabilities
						</div>
						<div className="flex flex-wrap gap-2">
							{getCapabilityIcons(provider, model).map(
								({ icon: Icon, label }) => (
									<Tooltip key={label}>
										<TooltipTrigger asChild>
											<div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/70 border hover:bg-muted transition-colors cursor-help">
												<Icon size={14} />
												<span className="text-xs font-medium">{label}</span>
											</div>
										</TooltipTrigger>
										<TooltipContent
											side="top"
											className="bg-background text-foreground"
										>
											<p className="text-xs">Supports {label.toLowerCase()}</p>
										</TooltipContent>
									</Tooltip>
								),
							)}
						</div>
					</div>

					<Button
						variant="default"
						size="default"
						className="w-full gap-2 font-semibold"
						onClick={(e) => e.stopPropagation()}
						asChild
					>
						<a
							href={`${config.playgroundUrl}?model=${encodeURIComponent(providerModelId)}`}
							target="_blank"
							rel="noopener noreferrer"
						>
							<Play className="h-4 w-4" />
							Try in Playground
						</a>
					</Button>
				</div>
			</Card>
		</TooltipProvider>
	);
}
