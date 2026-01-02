"use client";

import {
	AlertTriangle,
	Copy,
	Check,
	Play,
	ChevronDown,
	ChevronUp,
	Info,
} from "lucide-react";
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

import { getProviderIcon } from "@llmgateway/shared/components";

import type {
	ModelDefinition,
	ProviderModelMapping,
	providers,
	StabilityLevel,
} from "@llmgateway/models";
import type { LucideProps } from "lucide-react";

interface ModelWithProviders extends ModelDefinition {
	providerDetails: Array<{
		provider: ProviderModelMapping;
		providerInfo: (typeof providers)[number];
	}>;
}

export function ModelCard({
	model,
	shouldShowStabilityWarning,
	getCapabilityIcons,
	goToModel,
	formatPrice,
}: {
	model: ModelWithProviders;
	getCapabilityIcons: (
		provider: ProviderModelMapping,
		model?: any,
	) => {
		icon: React.ForwardRefExoticComponent<
			Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
		>;
		label: string;
		color: string;
	}[];
	shouldShowStabilityWarning: (
		stability?: StabilityLevel,
	) => boolean | undefined;
	goToModel: () => void;
	formatPrice: (
		price: number | undefined,
		discount?: number,
	) => string | React.JSX.Element;
}) {
	const config = useAppConfig();
	const [copiedModel, setCopiedModel] = useState<string | null>(null);
	const [showAllProviders, setShowAllProviders] = useState(false);

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
		setCopiedModel(text);
		setTimeout(() => setCopiedModel(null), 2000);
	};

	const hasProviderStabilityWarning = (provider: ProviderModelMapping) => {
		return (
			provider.stability &&
			["unstable", "experimental"].includes(provider.stability)
		);
	};

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
								{model.name || model.id}
							</h3>
							<div
								onClick={(e) => e.stopPropagation()}
								onMouseDown={(e) => e.stopPropagation()}
							>
								<ModelCodeExampleDialog modelId={model.id} />
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
							{model.id}
						</code>
						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="sm"
								className="h-8 w-8 p-0 shrink-0 hover:bg-muted text-muted-foreground hover:text-foreground"
								onClick={(e) => {
									e.stopPropagation();
									copyToClipboard(model.id);
								}}
								title="Copy root model ID"
							>
								{copiedModel === model.id ? (
									<Check className="h-4 w-4 text-green-400" />
								) : (
									<Copy className="h-4 w-4" />
								)}
							</Button>
						</div>
					</div>

					{/* Info about root model auto-selection */}
					<div className="mt-1">
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-help"
									onClick={(e) => e.stopPropagation()}
									title="Auto provider selection"
								>
									<Info className="h-3.5 w-3.5" />
									<span>Using root model ID</span>
								</button>
							</TooltipTrigger>
							<TooltipContent side="bottom" className="max-w-xs">
								<p className="text-xs">
									Using this model ID routes to the best provider based on
									stability, uptime, and price.
								</p>
							</TooltipContent>
						</Tooltip>
					</div>

					<div className="space-y-4">
						<h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
							Providers
						</h4>

						{(showAllProviders
							? model.providerDetails
							: model.providerDetails.slice(0, 1)
						).map(({ provider, providerInfo }) => {
							const providerModelId = `${provider.providerId}/${model.id}`;
							const ProviderIcon = getProviderIcon(provider.providerId);

							return (
								<div
									key={`${provider.providerId}-${provider.modelName}-${model.id}`}
									className="p-3 rounded-lg bg-muted/50 border space-y-3"
								>
									<div className="flex items-center gap-2">
										<div className="w-6 h-6 rounded flex items-center justify-center shrink-0 bg-background">
											{ProviderIcon ? (
												<ProviderIcon className="h-5 w-5" />
											) : (
												<span className="text-xs font-bold">
													{(providerInfo?.name || provider.providerId)
														.charAt(0)
														.toUpperCase()}
												</span>
											)}
										</div>
										<span className="text-base font-semibold text-foreground">
											{providerInfo?.name || provider.providerId}
										</span>
										{hasProviderStabilityWarning(provider) && (
											<AlertTriangle className="h-4 w-4 text-amber-400" />
										)}
									</div>

									<div className="flex items-center gap-2 p-2 rounded-md bg-muted border">
										<code className="text-xs font-mono text-muted-foreground flex-1 truncate">
											{providerModelId}
										</code>
										<div className="flex items-center gap-1">
											<Button
												variant="ghost"
												size="sm"
												className="h-7 w-7 p-0 shrink-0 hover:bg-muted text-muted-foreground hover:text-foreground"
												onClick={(e) => {
													e.stopPropagation();
													copyToClipboard(providerModelId);
												}}
												title="Copy provider model ID"
											>
												{copiedModel === providerModelId ? (
													<Check className="h-3.5 w-3.5 text-green-400" />
												) : (
													<Copy className="h-3.5 w-3.5" />
												)}
											</Button>
											<div
												onClick={(e) => e.stopPropagation()}
												onMouseDown={(e) => e.stopPropagation()}
											>
												<ModelCodeExampleDialog modelId={providerModelId} />
											</div>
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
											<Badge className="text-xs px-2 py-0.5 font-semibold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
												{provider.stability || "STABLE"}
											</Badge>
										</div>
									</div>

									<div>
										<div className="text-xs text-muted-foreground mb-2">
											Pricing
										</div>
										<div className="grid grid-cols-3 gap-3">
											<div className="space-y-1">
												<div className="text-xs text-muted-foreground">
													Input
												</div>
												<div className="font-semibold text-foreground text-sm">
													{typeof formatPrice(
														provider.inputPrice,
														provider.discount,
													) === "string" ? (
														<>
															{formatPrice(
																provider.inputPrice,
																provider.discount,
															)}
															<span className="text-muted-foreground text-xs ml-1">
																/M
															</span>
														</>
													) : (
														<span className="inline-flex items-baseline gap-1">
															{formatPrice(
																provider.inputPrice,
																provider.discount,
															)}
															<span className="text-muted-foreground text-xs">
																/M
															</span>
														</span>
													)}
												</div>
											</div>
											<div className="space-y-1">
												<div className="text-xs text-muted-foreground">
													Cached
												</div>
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
															<span className="text-muted-foreground text-xs">
																/M
															</span>
														</span>
													)}
												</div>
											</div>
											<div className="space-y-1">
												<div className="text-xs text-muted-foreground">
													Output
												</div>
												<div className="font-semibold text-foreground text-sm">
													{typeof formatPrice(
														provider.outputPrice,
														provider.discount,
													) === "string" ? (
														<>
															{formatPrice(
																provider.outputPrice,
																provider.discount,
															)}
															<span className="text-muted-foreground text-xs ml-1">
																/M
															</span>
														</>
													) : (
														<span className="inline-flex items-baseline gap-1">
															{formatPrice(
																provider.outputPrice,
																provider.discount,
															)}
															<span className="text-muted-foreground text-xs">
																/M
															</span>
														</span>
													)}
												</div>
											</div>
											{provider.imageOutputPrice !== undefined && (
												<div className="space-y-1">
													<div className="text-xs text-muted-foreground">
														Image Out
													</div>
													<div className="font-semibold text-foreground text-sm">
														{typeof formatPrice(
															provider.imageOutputPrice,
															provider.discount,
														) === "string" ? (
															<>
																{formatPrice(
																	provider.imageOutputPrice,
																	provider.discount,
																)}
																<span className="text-muted-foreground text-xs ml-1">
																	/M
																</span>
															</>
														) : (
															<span className="inline-flex items-baseline gap-1">
																{formatPrice(
																	provider.imageOutputPrice,
																	provider.discount,
																)}
																<span className="text-muted-foreground text-xs">
																	/M
																</span>
															</span>
														)}
													</div>
												</div>
											)}
											{provider.requestPrice !== undefined && (
												<div className="space-y-1">
													<div className="text-xs text-muted-foreground">
														Per Request
													</div>
													<div className="font-semibold text-foreground text-sm">
														${provider.requestPrice.toFixed(3)}
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
																<span className="text-xs font-medium">
																	{label}
																</span>
															</div>
														</TooltipTrigger>
														<TooltipContent
															side="top"
															className="bg-background text-foreground"
														>
															<p className="text-xs">
																Supports {label.toLowerCase()}
															</p>
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
							);
						})}

						{model.providerDetails.length > 1 && (
							<Button
								variant="ghost"
								size="sm"
								className="w-full gap-2 text-muted-foreground hover:text-foreground hover:bg-muted"
								onClick={(e) => {
									e.stopPropagation();
									setShowAllProviders((v) => !v);
								}}
							>
								{showAllProviders ? (
									<>
										<ChevronUp className="h-4 w-4" /> Show fewer providers
									</>
								) : (
									<>
										<ChevronDown className="h-4 w-4" /> Show{" "}
										{model.providerDetails.length - 1} more
									</>
								)}
							</Button>
						)}
					</div>
				</div>
			</Card>
		</TooltipProvider>
	);
}
