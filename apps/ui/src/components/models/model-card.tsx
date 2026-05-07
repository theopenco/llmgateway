"use client";

import {
	AlertTriangle,
	AlertCircle,
	Copy,
	Check,
	ChevronDown,
	ChevronUp,
	Globe,
	Linkedin,
	Share2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ModelCodeExampleDialog } from "@/components/models/model-code-example-dialog";
import { ModelCtaButton } from "@/components/models/model-cta-button";
import { ModelStatusBadge } from "@/components/models/model-status-badge";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import { TooltipProvider } from "@/lib/components/tooltip";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { XIcon } from "@/lib/icons/XIcon";
import { formatContextSize, formatDeprecationDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared/components";

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

function PriceCell({
	label,
	price,
	discount,
	unit,
	formatPrice,
}: {
	label: string;
	price: string | null | undefined;
	discount?: string | null;
	unit: string;
	formatPrice: (
		price: string | null | undefined,
		discount?: string | null,
	) => string | React.JSX.Element;
}) {
	const formatted = formatPrice(price, discount);
	return (
		<div className="text-center">
			<div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
				{label}
			</div>
			<div className="font-semibold text-foreground text-sm tabular-nums">
				{formatted}
			</div>
			<div className="text-[10px] text-muted-foreground/50">{unit}</div>
		</div>
	);
}

function StabilityDot({ stability }: { stability: string | null | undefined }) {
	const level = stability ?? "stable";
	const colorClass =
		level === "stable"
			? "bg-emerald-500"
			: level === "beta"
				? "bg-amber-500"
				: "bg-red-500";
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					className={cn(
						"inline-block h-2 w-2 rounded-full shrink-0",
						colorClass,
					)}
				/>
			</TooltipTrigger>
			<TooltipContent side="top" className="text-xs">
				{level.charAt(0).toUpperCase() + level.slice(1)}
			</TooltipContent>
		</Tooltip>
	);
}

function isImageGenModel(model: Pick<ApiModel, "output">): boolean {
	return Array.isArray(model.output) && model.output.includes("image");
}

function hasEstimatedImageCost(mapping: ApiModelProviderMapping): boolean {
	return Boolean(
		mapping.imageOutputPrice && mapping.imageOutputTokensByResolution,
	);
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
	const [copiedModel, setCopiedModel] = useState<string | null>(null);
	const [showAllProviders, setShowAllProviders] = useState(false);

	const copyToClipboard = (text: string) => {
		void navigator.clipboard.writeText(text);
		setCopiedModel(text);
		setTimeout(() => setCopiedModel(null), 2000);
	};

	const now = new Date();
	const allHaveDeactivatedAt =
		model.providerDetails.length > 0 &&
		model.providerDetails.every(({ provider }) => provider.deactivatedAt);
	const allHaveDeprecatedAt =
		!allHaveDeactivatedAt &&
		model.providerDetails.length > 0 &&
		model.providerDetails.every(({ provider }) => provider.deprecatedAt);
	const deactivationAllPast =
		allHaveDeactivatedAt &&
		model.providerDetails.every(
			({ provider }) => new Date(provider.deactivatedAt!) <= now,
		);
	const deprecationAllPast =
		allHaveDeprecatedAt &&
		model.providerDetails.every(
			({ provider }) => new Date(provider.deprecatedAt!) <= now,
		);

	const hasProviderStabilityWarning = (
		provider: ApiModelProviderMapping,
	): boolean => {
		return (
			provider.stability !== null &&
			provider.stability !== undefined &&
			["unstable", "experimental"].includes(provider.stability)
		);
	};

	// Group provider details by providerId to handle regional pricing
	const groupedByProvider = useMemo(() => {
		const map = new Map<
			string,
			{
				providerInfo: ApiProvider;
				providerId: string;
				mappings: ApiModelProviderMapping[];
			}
		>();
		for (const { provider, providerInfo } of model.providerDetails) {
			const key = provider.providerId;
			if (!map.has(key)) {
				map.set(key, {
					providerInfo,
					providerId: key,
					mappings: [],
				});
			}
			map.get(key)!.mappings.push(provider);
		}
		return Array.from(map.values());
	}, [model.providerDetails]);

	// Determine the best discount across all providers for the header badge
	const bestDiscount = useMemo(() => {
		let max = 0;
		for (const { provider } of model.providerDetails) {
			if (provider.discount) {
				const d = parseFloat(provider.discount);
				if (d > max) {
					max = d;
				}
			}
		}
		return max;
	}, [model.providerDetails]);

	// Get capabilities as union across all providers
	const capabilities = useMemo(() => {
		if (model.providerDetails.length === 0) {
			return [];
		}
		const seen = new Set<string>();
		const result: ReturnType<typeof getCapabilityIcons> = [];
		for (const { provider } of model.providerDetails) {
			for (const cap of getCapabilityIcons(provider, model)) {
				if (!seen.has(cap.label)) {
					seen.add(cap.label);
					result.push(cap);
				}
			}
		}
		return result;
	}, [model, getCapabilityIcons]);

	return (
		<TooltipProvider>
			<Card
				className="group relative overflow-hidden border border-border/50 bg-background hover:border-border transition-all duration-200 cursor-pointer py-0"
				onClick={goToModel}
			>
				{/* Subtle top accent line */}
				<div className="h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

				<div className="p-5">
					{/* Header: Model name + meta */}
					<div className="mb-4">
						<div className="flex items-start justify-between gap-3 mb-2">
							<div className="min-w-0 flex-1">
								<h3 className="text-lg font-bold text-foreground tracking-tight truncate">
									{model.name ?? model.id}
								</h3>
							</div>
							<div className="flex items-center gap-1.5 shrink-0">
								{shouldShowStabilityWarning(model.stability) && (
									<AlertTriangle className="h-4 w-4 text-amber-400" />
								)}
								<div
									onClick={(e) => e.stopPropagation()}
									onMouseDown={(e) => e.stopPropagation()}
								>
									<ModelCodeExampleDialog modelId={model.id} />
								</div>
							</div>
						</div>

						<div className="flex flex-wrap items-center gap-1.5">
							<Badge
								variant="secondary"
								className="text-[10px] font-medium bg-muted/80 text-muted-foreground border-0 px-2 py-0.5"
							>
								{model.family}
							</Badge>
							{bestDiscount > 0 && (
								<Badge className="text-[10px] px-2 py-0.5 font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
									{Math.round(bestDiscount * 100)}% off
								</Badge>
							)}
							{allHaveDeactivatedAt && (
								<ModelStatusBadge
									status="deactivated"
									isPast={deactivationAllPast}
								/>
							)}
							{allHaveDeprecatedAt && (
								<ModelStatusBadge
									status="deprecated"
									isPast={deprecationAllPast}
								/>
							)}
						</div>
					</div>

					{/* Model ID bar */}
					<div className="flex items-center gap-1.5 px-2.5 py-2 rounded-md bg-muted/50 border border-border/50 mb-4">
						<code className="text-xs font-mono text-muted-foreground flex-1 truncate">
							{model.id}
						</code>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 w-6 p-0 shrink-0 text-muted-foreground/60 hover:text-foreground hover:bg-transparent"
							onClick={(e) => {
								e.stopPropagation();
								copyToClipboard(model.id);
							}}
							title="Copy model ID"
						>
							{copiedModel === model.id ? (
								<Check className="h-3.5 w-3.5 text-emerald-400" />
							) : (
								<Copy className="h-3.5 w-3.5" />
							)}
						</Button>
					</div>

					{/* Capabilities row */}
					{capabilities.length > 0 && (
						<div className="flex flex-wrap gap-1.5 mb-4">
							{capabilities.map(({ icon: Icon, label, color }) => (
								<Tooltip key={label}>
									<TooltipTrigger asChild>
										<div
											className={cn(
												"inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium cursor-help transition-colors",
												"bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent hover:border-border/50",
											)}
										>
											<Icon size={12} className={color} />
											{label}
										</div>
									</TooltipTrigger>
									<TooltipContent side="top" className="text-xs">
										Supports {label.toLowerCase()}
									</TooltipContent>
								</Tooltip>
							))}
						</div>
					)}

					{/* Providers section */}
					<div className="space-y-3">
						{(showAllProviders
							? groupedByProvider
							: groupedByProvider.slice(0, 1)
						).map(({ providerInfo, providerId, mappings }) => {
							const ProviderIcon = getProviderIcon(providerId);
							// Determine if this provider has multiple regions
							const hasRegions =
								mappings.length > 1 ||
								(mappings.length === 1 && !!mappings[0].region);

							return (
								<ProviderSection
									key={providerId}
									modelId={model.id}
									providerInfo={providerInfo}
									providerId={providerId}
									ProviderIcon={ProviderIcon}
									mappings={mappings}
									hasRegions={hasRegions}
									hasProviderStabilityWarning={hasProviderStabilityWarning}
									formatPrice={formatPrice}
									copyToClipboard={copyToClipboard}
									copiedModel={copiedModel}
									isImageGen={isImageGenModel(model)}
								/>
							);
						})}

						{groupedByProvider.length > 1 && (
							<button
								type="button"
								className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
								onClick={(e) => {
									e.stopPropagation();
									setShowAllProviders((v) => !v);
								}}
							>
								{showAllProviders ? (
									<>
										<ChevronUp className="h-3.5 w-3.5" />
										Fewer providers
									</>
								) : (
									<>
										<ChevronDown className="h-3.5 w-3.5" />
										{groupedByProvider.length - 1} more provider
										{groupedByProvider.length - 1 > 1 ? "s" : ""}
									</>
								)}
							</button>
						)}
					</div>

					{/* CTA */}
					<div className="mt-4 pt-4 border-t border-border/30">
						<ModelCtaButton
							modelId={`${groupedByProvider[0]?.providerId}/${model.id}`}
							onClick={(e) => e.stopPropagation()}
						/>
					</div>
				</div>
			</Card>
		</TooltipProvider>
	);
}

function ShareDropdown({
	modelId,
	providerId,
}: {
	modelId: string;
	providerId: string;
}) {
	const [urlCopied, setUrlCopied] = useState(false);
	const shareUrl = `https://llmgateway.io/models/${encodeURIComponent(modelId)}/${encodeURIComponent(providerId)}`;
	const shareTitle = `${providerId} - ${modelId} on LLM Gateway`;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 w-6 p-0 text-muted-foreground/60 hover:text-foreground hover:bg-transparent"
					onClick={(e) => e.stopPropagation()}
					title="Share"
				>
					<Share2 className="h-3 w-3" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					onClick={async (e) => {
						e.stopPropagation();
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
						onClick={(e) => e.stopPropagation()}
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
						onClick={(e) => e.stopPropagation()}
					>
						<Linkedin className="h-4 w-4 mr-2" />
						Share on LinkedIn
					</a>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function ProviderSection({
	modelId,
	providerInfo,
	providerId,
	ProviderIcon,
	mappings,
	hasRegions,
	hasProviderStabilityWarning,
	formatPrice,
	copyToClipboard,
	copiedModel,
	isImageGen = false,
}: {
	modelId: string;
	providerInfo: ApiProvider;
	providerId: string;
	ProviderIcon: React.ComponentType<{ className?: string }> | null;
	mappings: ApiModelProviderMapping[];
	hasRegions: boolean;
	hasProviderStabilityWarning: (provider: ApiModelProviderMapping) => boolean;
	formatPrice: (
		price: string | null | undefined,
		discount?: string | null,
	) => string | React.JSX.Element;
	copyToClipboard: (text: string) => void;
	copiedModel: string | null;
	isImageGen?: boolean;
}) {
	const [activeRegionIdx, setActiveRegionIdx] = useState(0);
	const [showTokenPricing, setShowTokenPricing] = useState(false);
	const activeMapping = mappings[activeRegionIdx] ?? mappings[0];
	const providerModelId = activeMapping.region
		? `${providerId}/${modelId}:${activeMapping.region}`
		: `${providerId}/${modelId}`;
	const hasImageCostEstimate = hasEstimatedImageCost(activeMapping);
	const shouldShowTokenPricing =
		!isImageGen || showTokenPricing || !hasImageCostEstimate;

	return (
		<div className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
			{/* Provider header */}
			<div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border/30">
				<div className="flex items-center gap-2 min-w-0">
					<div className="w-5 h-5 rounded flex items-center justify-center shrink-0">
						{ProviderIcon ? (
							<ProviderIcon className="h-4 w-4" />
						) : (
							<span className="text-[10px] font-bold text-muted-foreground">
								{(providerInfo?.name ?? providerId).charAt(0).toUpperCase()}
							</span>
						)}
					</div>
					<span className="text-sm font-semibold text-foreground truncate">
						{providerInfo?.name ?? providerId}
					</span>
					<StabilityDot stability={activeMapping.stability} />
					{hasProviderStabilityWarning(activeMapping) && (
						<AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
					)}
				</div>
				<div className="flex items-center gap-1 shrink-0">
					<ShareDropdown modelId={modelId} providerId={providerId} />
					<Button
						variant="ghost"
						size="sm"
						className="h-6 w-6 p-0 text-muted-foreground/60 hover:text-foreground hover:bg-transparent"
						onClick={(e) => {
							e.stopPropagation();
							copyToClipboard(providerModelId);
						}}
						title="Copy provider/model ID"
					>
						{copiedModel === providerModelId ? (
							<Check className="h-3 w-3 text-emerald-400" />
						) : (
							<Copy className="h-3 w-3" />
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

			{/* Region tabs (if applicable) */}
			{hasRegions && mappings.length > 1 && (
				<div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border/30 bg-muted/30 overflow-x-auto">
					<Globe className="h-3 w-3 text-muted-foreground/50 shrink-0 mr-1" />
					{mappings.map((mapping, idx) => (
						<button
							key={`${mapping.providerId}-${mapping.region ?? "default"}-${idx}`}
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setActiveRegionIdx(idx);
							}}
							className={cn(
								"px-2 py-1 rounded text-[10px] font-medium transition-colors whitespace-nowrap",
								activeRegionIdx === idx
									? "bg-background text-foreground shadow-sm border border-border/50"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{mapping.region ?? "Default"}
						</button>
					))}
				</div>
			)}

			{/* Content */}
			<div className="px-3 py-3 space-y-3">
				{/* Context + deprecation info */}
				<div className="flex items-center justify-between text-xs">
					<span className="text-muted-foreground">
						Context:{" "}
						<span className="text-foreground font-medium">
							{activeMapping.contextSize
								? formatContextSize(activeMapping.contextSize)
								: "—"}
						</span>
					</span>
					{activeMapping.discount && parseFloat(activeMapping.discount) > 0 && (
						<Badge className="text-[10px] px-1.5 py-0 h-4 font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
							{Math.round(parseFloat(activeMapping.discount) * 100)}% off
						</Badge>
					)}
				</div>

				{/* Deprecation/deactivation warnings */}
				{(activeMapping.deprecatedAt ?? activeMapping.deactivatedAt) && (
					<div className="flex flex-wrap gap-1.5">
						{activeMapping.deprecatedAt && (
							<Badge
								variant="outline"
								className="text-[10px] px-2 py-0.5 gap-1 bg-amber-500/5 text-amber-600 dark:text-amber-400 border-amber-500/20"
							>
								<AlertTriangle className="h-2.5 w-2.5" />
								{formatDeprecationDate(
									activeMapping.deprecatedAt,
									"deprecated",
								)}
							</Badge>
						)}
						{activeMapping.deactivatedAt && (
							<Badge
								variant="outline"
								className="text-[10px] px-2 py-0.5 gap-1 bg-red-500/5 text-red-600 dark:text-red-400 border-red-500/20"
							>
								<AlertCircle className="h-2.5 w-2.5" />
								{formatDeprecationDate(
									activeMapping.deactivatedAt,
									"deactivated",
								)}
							</Badge>
						)}
					</div>
				)}

				{/* Per-image summary for image-gen models */}
				{isImageGen &&
					(() => {
						const discountNum = activeMapping.discount
							? parseFloat(activeMapping.discount)
							: 0;
						const requestPriceNum =
							activeMapping.requestPrice !== null &&
							activeMapping.requestPrice !== undefined
								? parseFloat(activeMapping.requestPrice)
								: 0;
						let perImage: number | null = null;
						let label = "Per image";
						let outputCost = 0;
						let resolutionKey: string | null = null;
						if (
							activeMapping.imageOutputPrice &&
							activeMapping.imageOutputTokensByResolution
						) {
							const outPrice = parseFloat(activeMapping.imageOutputPrice);
							const entries = Object.entries(
								activeMapping.imageOutputTokensByResolution,
							);
							const preferred =
								entries.find(([k]) => k !== "default") ?? entries[0];
							if (preferred) {
								outputCost = preferred[1] * outPrice;
								resolutionKey = preferred[0];
							}
							if (requestPriceNum > 0 || outputCost > 0) {
								perImage = requestPriceNum + outputCost;
								if (resolutionKey) {
									label = `Per image (${resolutionKey})`;
								}
							}
						}
						if (perImage === null) {
							return null;
						}
						const discounted = perImage * (1 - discountNum);
						return (
							<div className="rounded-md bg-muted/40 border border-border/30 p-3">
								<div className="flex items-center justify-between gap-2">
									<div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
										{label}
									</div>
									<div className="font-semibold tabular-nums text-sm">
										{discountNum > 0 ? (
											<>
												<span className="line-through text-muted-foreground mr-1 text-xs">
													${perImage.toFixed(4)}
												</span>
												<span className="text-green-600">
													${discounted.toFixed(4)}
												</span>
											</>
										) : (
											`$${perImage.toFixed(4)}`
										)}
									</div>
								</div>
							</div>
						);
					})()}

				{/* Token pricing (hidden by default for image-gen models) */}
				{!shouldShowTokenPricing ? null : activeMapping.perSecondPrice &&
				  Object.keys(activeMapping.perSecondPrice).length > 0 ? (
					<div className="rounded-md bg-muted/40 border border-border/30 p-2.5">
						<div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-2">
							Per Second Pricing
						</div>
						<div className="space-y-1">
							{(() => {
								const prices = activeMapping.perSecondPrice!;
								const defaultVideo = prices["default_video"];
								const defaultAudio = prices["default_audio"];
								if (defaultVideo && defaultAudio) {
									return (
										<div className="flex justify-between text-sm">
											<span className="text-muted-foreground">
												Video / Audio
											</span>
											<span className="font-semibold tabular-nums">
												${defaultVideo} – ${defaultAudio}
												<span className="text-muted-foreground/60 text-xs ml-0.5">
													/sec
												</span>
											</span>
										</div>
									);
								}
								const defaultPrice = prices["default"];
								if (defaultPrice) {
									return (
										<div className="flex justify-between text-sm">
											<span className="text-muted-foreground">Default</span>
											<span className="font-semibold tabular-nums">
												${defaultPrice}
												<span className="text-muted-foreground/60 text-xs ml-0.5">
													/sec
												</span>
											</span>
										</div>
									);
								}
								return Object.entries(prices).map(([key, value]) => (
									<div key={key} className="flex justify-between text-xs">
										<span className="text-muted-foreground">{key}</span>
										<span className="font-mono tabular-nums">${value}/sec</span>
									</div>
								));
							})()}
						</div>
					</div>
				) : (
					<div className="grid grid-cols-3 gap-px rounded-md bg-border/30 border border-border/30 overflow-hidden">
						<div className="bg-background p-2">
							<PriceCell
								label="Input"
								price={activeMapping.inputPrice}
								discount={activeMapping.discount}
								unit="/M tokens"
								formatPrice={formatPrice}
							/>
						</div>
						<div className="bg-background p-2">
							<PriceCell
								label="Cached"
								price={activeMapping.cachedInputPrice}
								discount={activeMapping.discount}
								unit="/M tokens"
								formatPrice={formatPrice}
							/>
						</div>
						<div className="bg-background p-2">
							<PriceCell
								label="Output"
								price={activeMapping.outputPrice}
								discount={activeMapping.discount}
								unit="/M tokens"
								formatPrice={formatPrice}
							/>
						</div>
					</div>
				)}

				{/* Image pricing (if applicable) */}
				{(activeMapping.imageInputTokensByResolution ??
					activeMapping.imageOutputTokensByResolution ??
					activeMapping.imageOutputPrice) && (
					<div className="rounded-md bg-muted/40 border border-border/30 p-2.5">
						<div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-2">
							{activeMapping.imageOutputTokensByResolution
								? "Image Pricing (est. per image)"
								: "Image Pricing"}
						</div>
						{activeMapping.imageInputPrice &&
							activeMapping.imageInputTokensByResolution &&
							(() => {
								const imageInputPriceNum = parseFloat(
									activeMapping.imageInputPrice!,
								);
								const named = Object.entries(
									activeMapping.imageInputTokensByResolution!,
								).filter(([k]) => k !== "default");
								const defaultTokens =
									activeMapping.imageInputTokensByResolution!["default"];
								const entries: Array<[string, number]> =
									named.length > 0
										? named
										: defaultTokens !== undefined
											? [["any size", defaultTokens]]
											: [];
								if (entries.length === 0) {
									return null;
								}
								const discountNum = activeMapping.discount
									? parseFloat(activeMapping.discount)
									: 0;
								return (
									<div className="mb-1.5">
										<div className="text-[10px] text-muted-foreground mb-0.5">
											Input
										</div>
										{entries.map(([res, tokensPerImage]) => {
											const raw = tokensPerImage * imageInputPriceNum;
											const discounted = raw * (1 - discountNum);
											return (
												<div
													key={res}
													className="flex justify-between items-center text-xs py-0.5"
												>
													<span className="text-muted-foreground">{res}</span>
													<span className="font-mono tabular-nums">
														{discountNum > 0 ? (
															<>
																<span className="line-through text-muted-foreground mr-1">
																	~${raw.toFixed(4)}
																</span>
																<span className="text-green-600 font-semibold">
																	~${discounted.toFixed(4)}
																</span>
															</>
														) : (
															`~$${raw.toFixed(4)}`
														)}
													</span>
												</div>
											);
										})}
									</div>
								);
							})()}
						{activeMapping.imageOutputPrice &&
							!activeMapping.imageOutputTokensByResolution && (
								<div>
									<div className="text-[10px] text-muted-foreground mb-0.5">
										Image Output
									</div>
									<div className="flex justify-between items-center text-xs py-0.5">
										<span className="text-muted-foreground">Tokens</span>
										<div className="font-mono tabular-nums flex items-center gap-1">
											{formatPrice(
												activeMapping.imageOutputPrice,
												activeMapping.discount,
											)}
											<span className="text-muted-foreground/60">
												/M tokens
											</span>
										</div>
									</div>
								</div>
							)}
						{activeMapping.imageOutputPrice &&
							activeMapping.imageOutputTokensByResolution &&
							(() => {
								const imageOutputPriceNum = parseFloat(
									activeMapping.imageOutputPrice!,
								);
								const entries = Object.entries(
									activeMapping.imageOutputTokensByResolution!,
								).filter(([k]) => k !== "default");
								if (entries.length === 0) {
									return null;
								}
								const discountNum = activeMapping.discount
									? parseFloat(activeMapping.discount)
									: 0;
								return (
									<div>
										<div className="text-[10px] text-muted-foreground mb-0.5">
											Output
										</div>
										{entries.map(([res, tokensPerImage]) => {
											const raw = tokensPerImage * imageOutputPriceNum;
											const discounted = raw * (1 - discountNum);
											return (
												<div
													key={res}
													className="flex justify-between items-center text-xs py-0.5"
												>
													<span className="text-muted-foreground">{res}</span>
													<span className="font-mono tabular-nums">
														{discountNum > 0 ? (
															<>
																<span className="line-through text-muted-foreground mr-1">
																	~${raw.toFixed(4)}
																</span>
																<span className="text-green-600 font-semibold">
																	~${discounted.toFixed(4)}
																</span>
															</>
														) : (
															`~$${raw.toFixed(4)}`
														)}
													</span>
												</div>
											);
										})}
									</div>
								);
							})()}
					</div>
				)}

				{/* Per-request / per-search price (if applicable) */}
				{(!isImageGen &&
					activeMapping.requestPrice !== null &&
					activeMapping.requestPrice !== undefined &&
					parseFloat(activeMapping.requestPrice) > 0) ||
				(activeMapping.webSearchPrice !== null &&
					activeMapping.webSearchPrice !== undefined &&
					parseFloat(activeMapping.webSearchPrice) > 0) ? (
					<div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
						{!isImageGen &&
							activeMapping.requestPrice !== null &&
							activeMapping.requestPrice !== undefined &&
							parseFloat(activeMapping.requestPrice) > 0 && (
								<span>
									+ ${parseFloat(activeMapping.requestPrice).toFixed(3)}
									<span className="text-muted-foreground/60"> per request</span>
								</span>
							)}
						{activeMapping.webSearchPrice !== null &&
							activeMapping.webSearchPrice !== undefined &&
							parseFloat(activeMapping.webSearchPrice) > 0 && (
								<span>
									+ ${parseFloat(activeMapping.webSearchPrice).toFixed(3)}
									<span className="text-muted-foreground/60"> per search</span>
								</span>
							)}
					</div>
				) : null}

				{isImageGen && hasImageCostEstimate && (
					<button
						type="button"
						className="w-full flex items-center justify-center gap-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
						onClick={(e) => {
							e.stopPropagation();
							setShowTokenPricing((v) => !v);
						}}
					>
						{showTokenPricing ? (
							<>
								<ChevronUp className="h-3 w-3" />
								Hide token pricing
							</>
						) : (
							<>
								<ChevronDown className="h-3 w-3" />
								Expand details
							</>
						)}
					</button>
				)}
			</div>
		</div>
	);
}
