"use client";

import {
	AlertCircle,
	AlertTriangle,
	Ban,
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Code,
	Copy,
	Eye,
	Gift,
	Globe,
	MessageSquare,
	Wrench,
	Zap,
	Search,
	Filter,
	X,
	ArrowUpDown,
	ArrowUp,
	ArrowDown,
	Video,
	ImagePlus,
	ExternalLink,
	Gem,
	Percent,
	Scale,
	Braces,
	FileJson2,
	List,
	Grid,
	Bot,
	Boxes,
	Brain,
	Sparkles,
	PenTool,
	Sliders,
	Volume2,
	Mic,
	ListOrdered,
	Clock,
} from "lucide-react";
import Link from "next/link.js";
import { usePathname, useRouter, useSearchParams } from "next/navigation.js";
import React, { useMemo, useState, useCallback, useEffect } from "react";

import { getProviderIcon } from "@/components/provider-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Toggle } from "@/components/ui/toggle";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	getMappingStatus,
	isModelMappingStatus,
	shouldShowDeactivationNotice,
	type ModelMappingStatus,
} from "@/deactivation";
import { discountFraction } from "@/lib/discount";
import { cn } from "@/lib/utils";

import { matchesCapability } from "./capability-filters";
import { formatDeprecationDate, formatPerImagePriceRange } from "./format";
import { ModelCard } from "./model-card";
import { applyCategoryFilter } from "./model-category-filters";
import { isVisibleMapping } from "./status-filters";
import {
	applyUseCaseFilter,
	isUseCaseCategory,
	providerRowPassesFilters,
} from "./use-case-filters";
import { useIsMobile } from "./use-mobile";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "./api-types";
import type { ModelCategoryFilter } from "./model-category-filters";
import type { StabilityLevel } from "@llmgateway/models";

interface ModelWithProviders extends ApiModel {
	providerDetails: Array<{
		provider: ApiModelProviderMapping;
		providerInfo: ApiProvider;
	}>;
}

interface AllModelsProps {
	children: React.ReactNode;
	models: ApiModel[];
	providers: ApiProvider[];
	title?: string;
	description?: string;
	categoryFilter?: ModelCategoryFilter;
	seoContent?: React.ReactNode;
	footer?: React.ReactNode;
	renderCta?: (args: {
		modelId: string;
		output?: readonly string[] | null;
		size?: "default" | "sm";
		className?: string;
		iconClassName?: string;
		onClick?: (e: React.MouseEvent) => void;
	}) => React.ReactNode;
	modelHrefBase?: string;
	/**
	 * The premium/standard pricing tier only matters for DevPass fair-use
	 * limits, so the filter is hidden unless the surface opts in.
	 */
	showPricingTierFilter?: boolean;
	/**
	 * Use Case category applied when the URL has no `category` param
	 * (e.g. DevPass pins its directory to `code`).
	 */
	defaultCategory?: string;
	/**
	 * Hide the Use Case select entirely. Combine with `defaultCategory` when a
	 * surface is pinned to a single use case.
	 */
	hideUseCaseFilter?: boolean;
	/**
	 * Hide the page header (title, description and API docs/Compare buttons).
	 * Embedding surfaces like the dashboard render their own header instead.
	 */
	hideHeader?: boolean;
}

type SortField =
	| "provider"
	| "name"
	| "inputPrice"
	| "outputPrice"
	| "cachedInputPrice"
	| "discount";
type SortDirection = "asc" | "desc";

// Capability icon type
interface CapabilityIcon {
	icon: React.ComponentType<{ className?: string; size?: number | string }>;
	label: string;
	color: string;
}

// Flattened row structure for table view
interface FlattenedModelRow {
	model: ApiModel;
	provider: ApiModelProviderMapping;
	providerInfo: ApiProvider;
	hasAdditionalPricing: boolean;
	rowKey: string;
	capabilities: CapabilityIcon[];
	ProviderIcon: React.ComponentType<{ className?: string }> | null;
}

// Helper to compute capabilities (moved outside component for performance).
// Single source of truth for capability conditions and labels in both the
// table and grid views.
function computeCapabilities(
	provider: ApiModelProviderMapping,
	model?: ApiModel,
): CapabilityIcon[] {
	const capabilities: CapabilityIcon[] = [];
	if (provider.streaming) {
		capabilities.push({
			icon: Zap,
			label: "Streaming",
			color: "text-blue-500",
		});
	}
	if (provider.vision) {
		capabilities.push({ icon: Eye, label: "Vision", color: "text-green-500" });
	}
	if (provider.tools) {
		capabilities.push({
			icon: Wrench,
			label: "Tools",
			color: "text-purple-500",
		});
	}
	if (provider.reasoning) {
		capabilities.push({
			icon: MessageSquare,
			label: "Reasoning",
			color: "text-orange-500",
		});
	}
	if (provider.reasoningMaxTokens) {
		capabilities.push({
			icon: Sliders,
			label: "Reasoning Budget",
			color: "text-amber-500",
		});
	}
	if (provider.jsonOutput) {
		capabilities.push({
			icon: Braces,
			label: "JSON Output",
			color: "text-cyan-500",
		});
	}
	if (provider.jsonOutputSchema) {
		capabilities.push({
			icon: FileJson2,
			label: "Structured JSON",
			color: "text-teal-500",
		});
	}
	if (model?.output?.includes("image")) {
		capabilities.push({
			icon: ImagePlus,
			label: "Image Generation",
			color: "text-pink-500",
		});
	}
	if (model?.output?.includes("video")) {
		capabilities.push({
			icon: Video,
			label: "Video Generation",
			color: "text-violet-500",
		});
	}
	if (model?.output?.includes("audio")) {
		capabilities.push({
			icon: Volume2,
			label: "Speech Generation",
			color: "text-rose-500",
		});
	}
	if (model?.output?.includes("transcription")) {
		capabilities.push({
			icon: Mic,
			label: "Transcription",
			color: "text-sky-500",
		});
	}
	if (model?.output?.includes("embedding")) {
		capabilities.push({
			icon: Boxes,
			label: "Embeddings",
			color: "text-indigo-500",
		});
	}
	if (model?.output?.includes("rerank")) {
		capabilities.push({
			icon: ListOrdered,
			label: "Rerank",
			color: "text-amber-500",
		});
	}
	if (provider.webSearch) {
		capabilities.push({
			icon: Globe,
			label: "Web Search",
			color: "text-sky-500",
		});
	}
	return capabilities;
}

// Maps capability filter toggle keys to the capability label they pin to the
// front of the features column, so the icon the user is filtering by is always
// visible.
const CAPABILITY_LABEL_BY_FILTER_KEY: Record<string, string> = {
	streaming: "Streaming",
	vision: "Vision",
	tools: "Tools",
	reasoning: "Reasoning",
	reasoningBudget: "Reasoning Budget",
	jsonOutput: "JSON Output",
	jsonOutputSchema: "Structured JSON",
	imageGeneration: "Image Generation",
	videoGeneration: "Video Generation",
	audioGeneration: "Speech Generation",
	embedding: "Embeddings",
	rerank: "Rerank",
	webSearch: "Web Search",
};

// Memoized table row component for performance
const ModelTableRow = React.memo(
	({
		row,
		isExpanded,
		copiedModel,
		onToggleExpand,
		onCopy,
		onNavigate,
		formatPrice,
		modelHref,
		pinnedCapabilityKeys,
	}: {
		row: FlattenedModelRow;
		isExpanded: boolean;
		copiedModel: string | null;
		onToggleExpand: () => void;
		onCopy: (text: string, key: string, e: React.MouseEvent) => void;
		onNavigate: () => void;
		formatPrice: (
			price: string | null | undefined,
			discount?: string | null,
		) => React.ReactNode;
		modelHref: (path: string) => string;
		pinnedCapabilityKeys: string[];
	}) => {
		const { ProviderIcon } = row;
		const isCustom = row.model.source === "custom";
		const blockedReasons = row.provider.blockedReasons ?? [];
		const isBlocked = blockedReasons.length > 0;
		const showDeactivationNotice = shouldShowDeactivationNotice(row.provider);
		const mappingStatus = getMappingStatus(row.provider);
		const isScheduled = mappingStatus === "scheduled";

		return (
			<>
				<TableRow
					className={cn(
						"hover:bg-muted/50 transition-colors",
						isCustom ? "cursor-default" : "cursor-pointer",
						isBlocked && "opacity-60",
					)}
					onClick={onNavigate}
				>
					{/* Provider Column */}
					<TableCell className="font-medium">
						<div className="flex items-center gap-2">
							{row.hasAdditionalPricing ? (
								<button
									onClick={(e) => {
										e.stopPropagation();
										onToggleExpand();
									}}
									className="p-0.5 hover:bg-muted rounded"
									aria-label="Toggle additional pricing details"
									aria-expanded={isExpanded}
								>
									{isExpanded ? (
										<ChevronDown className="h-4 w-4 text-muted-foreground" />
									) : (
										<ChevronRight className="h-4 w-4 text-muted-foreground" />
									)}
								</button>
							) : (
								<div className="w-5 h-5" />
							)}
							{ProviderIcon ? (
								<ProviderIcon className="w-4 h-4" />
							) : (
								<div
									className="w-4 h-4 rounded-sm flex items-center justify-center text-xs font-medium text-white"
									style={{
										backgroundColor: row.providerInfo?.color ?? "#6b7280",
									}}
								>
									{(row.providerInfo?.name ?? row.provider.providerId)
										.charAt(0)
										.toUpperCase()}
								</div>
							)}
							{isCustom ? (
								<span className="text-sm">
									{row.providerInfo?.name ?? row.provider.providerId}
								</span>
							) : (
								<Link
									href={modelHref(
										`/models/${encodeURIComponent(row.model.id)}/${row.provider.providerId}`,
									)}
									onClick={(e) => e.stopPropagation()}
									className="text-sm hover:text-primary hover:underline"
								>
									{row.providerInfo?.name ?? row.provider.providerId}
									{row.provider.region && (
										<span className="text-muted-foreground text-xs ml-1">
											({row.provider.region})
										</span>
									)}
								</Link>
							)}
							{isCustom && (
								<Badge
									variant="outline"
									className="text-[10px] px-1.5 py-0 shrink-0"
								>
									Custom
								</Badge>
							)}
							{isBlocked && (
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="shrink-0 cursor-help">
											<Ban className="h-3.5 w-3.5 text-red-500" />
										</span>
									</TooltipTrigger>
									<TooltipContent className="max-w-xs">
										<p className="text-xs font-medium mb-1">
											Not available under your organization&apos;s compliance
											policy:
										</p>
										<ul
											className={cn(
												"text-xs",
												blockedReasons.length > 1 &&
													"list-disc pl-4 space-y-0.5",
											)}
										>
											{blockedReasons.map((reason) => (
												<li key={reason}>{reason}</li>
											))}
										</ul>
									</TooltipContent>
								</Tooltip>
							)}
							{showDeactivationNotice && (
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="shrink-0 cursor-help">
											{isScheduled ? (
												<Clock className="h-3.5 w-3.5 text-amber-500" />
											) : (
												<AlertCircle className="h-3.5 w-3.5 text-red-500" />
											)}
										</span>
									</TooltipTrigger>
									<TooltipContent>
										<p className="text-xs">
											{formatDeprecationDate(
												row.provider.deactivatedAt!,
												"deactivated",
											)}
										</p>
									</TooltipContent>
								</Tooltip>
							)}
							{!showDeactivationNotice && row.provider.deprecatedAt && (
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="shrink-0 cursor-help">
											<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
										</span>
									</TooltipTrigger>
									<TooltipContent>
										<p className="text-xs">
											{formatDeprecationDate(
												row.provider.deprecatedAt,
												"deprecated",
											)}
										</p>
									</TooltipContent>
								</Tooltip>
							)}
							{!isCustom && (
								<ExternalLink className="h-3 w-3 text-muted-foreground" />
							)}
						</div>
					</TableCell>

					{/* Model ID Column */}
					<TableCell>
						<div className="flex items-center gap-2">
							{isCustom ? (
								<span className="font-medium text-sm">{row.model.id}</span>
							) : (
								<Link
									href={modelHref(
										`/models/${encodeURIComponent(row.model.id)}`,
									)}
									onClick={(e) => e.stopPropagation()}
									className="font-medium text-sm hover:text-primary hover:underline"
								>
									{row.model.id}
								</Link>
							)}
							{row.model.premium && (
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="shrink-0 cursor-help">
											<Gem className="h-3.5 w-3.5 text-amber-500" />
										</span>
									</TooltipTrigger>
									<TooltipContent>
										<p className="text-xs">
											Premium tier — $5+/M input or $15+/M output. Subject to
											the weekly fair-use allowance on DevPass plans.
										</p>
									</TooltipContent>
								</Tooltip>
							)}
							<button
								onClick={(e) => {
									// Custom models are requested as `<name>/<model>`, which is
									// already the row's model id.
									const fullId = isCustom
										? row.model.id
										: row.provider.region
											? `${row.provider.providerId}/${row.model.id}:${row.provider.region}`
											: `${row.provider.providerId}/${row.model.id}`;
									onCopy(fullId, row.rowKey, e);
								}}
								className="p-1 hover:bg-muted rounded transition-colors"
								title={copiedModel === row.rowKey ? "Copied!" : "Copy model ID"}
							>
								{copiedModel === row.rowKey ? (
									<Check className="h-3 w-3 text-green-500" />
								) : (
									<Copy className="h-3 w-3 text-muted-foreground" />
								)}
							</button>
						</div>
					</TableCell>

					{/* Input Price Column */}
					<TableCell className="text-right font-mono text-sm">
						{row.provider.perSecondPrice && !row.provider.inputPrice ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="text-violet-500 cursor-help">
										{(() => {
											const prices = row.provider.perSecondPrice;
											const values = Object.values(prices)
												.map(Number)
												.filter(Number.isFinite);
											if (values.length === 0) {
												return "—";
											}
											const min = Math.min(...values);
											return `$${min}/sec`;
										})()}
									</span>
								</TooltipTrigger>
								<TooltipContent>
									<p className="text-xs">Video per-second pricing</p>
								</TooltipContent>
							</Tooltip>
						) : (!row.provider.inputPrice ||
								parseFloat(row.provider.inputPrice) === 0) &&
						  row.provider.inputCharacterPrice &&
						  parseFloat(row.provider.inputCharacterPrice) > 0 ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="text-sky-500 cursor-help">
										$
										{parseFloat(
											(
												parseFloat(row.provider.inputCharacterPrice) * 1000
											).toFixed(4),
										)}
										/1K chars
									</span>
								</TooltipTrigger>
								<TooltipContent>
									<p className="text-xs">
										Per-character pricing (not per token)
									</p>
								</TooltipContent>
							</Tooltip>
						) : (!row.provider.inputPrice ||
								parseFloat(row.provider.inputPrice) === 0) &&
						  row.provider.requestPrice &&
						  parseFloat(row.provider.requestPrice) > 0 ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="text-amber-500 cursor-help">
										${parseFloat(row.provider.requestPrice).toFixed(3)}/req
									</span>
								</TooltipTrigger>
								<TooltipContent>
									<p className="text-xs">Per-request pricing (not per token)</p>
								</TooltipContent>
							</Tooltip>
						) : (!row.provider.inputPrice ||
								parseFloat(row.provider.inputPrice) === 0) &&
						  row.provider.perImagePrice &&
						  Object.keys(row.provider.perImagePrice).length > 0 ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="text-amber-500 cursor-help">
										{(() => {
											const range = formatPerImagePriceRange(
												row.provider.perImagePrice,
												row.provider.discount,
											);
											return range ? `${range}/image` : "—";
										})()}
									</span>
								</TooltipTrigger>
								<TooltipContent>
									<p className="text-xs">
										Per-image pricing by output resolution (not per token)
									</p>
								</TooltipContent>
							</Tooltip>
						) : (
							formatPrice(row.provider.inputPrice, row.provider.discount)
						)}
					</TableCell>

					{/* Output Price Column */}
					<TableCell className="text-right font-mono text-sm">
						{row.provider.perSecondPrice && !row.provider.outputPrice ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="text-violet-500 cursor-help">
										{(() => {
											const prices = row.provider.perSecondPrice;
											const values = Object.values(prices)
												.map(Number)
												.filter(Number.isFinite);
											if (values.length === 0) {
												return "—";
											}
											const max = Math.max(...values);
											return `$${max}/sec`;
										})()}
									</span>
								</TooltipTrigger>
								<TooltipContent>
									<p className="text-xs">Video per-second pricing</p>
								</TooltipContent>
							</Tooltip>
						) : (!row.provider.outputPrice ||
								parseFloat(row.provider.outputPrice) === 0) &&
						  ((row.provider.requestPrice &&
								parseFloat(row.provider.requestPrice) > 0) ||
								(row.provider.perImagePrice &&
									Object.keys(row.provider.perImagePrice).length > 0) ||
								(row.provider.inputCharacterPrice &&
									parseFloat(row.provider.inputCharacterPrice) > 0)) ? (
							<span className="text-muted-foreground">—</span>
						) : (
							formatPrice(row.provider.outputPrice, row.provider.discount)
						)}
					</TableCell>

					{/* Cache Read Price Column */}
					<TableCell className="text-right font-mono text-sm">
						{formatPrice(row.provider.cachedInputPrice, row.provider.discount)}
					</TableCell>

					{/* Features Column */}
					<TableCell className="text-center">
						{(() => {
							const pinnedLabels = pinnedCapabilityKeys
								.map((key) => CAPABILITY_LABEL_BY_FILTER_KEY[key])
								.filter((label): label is string => Boolean(label));
							const ordered = [
								...row.capabilities.filter((c) =>
									pinnedLabels.includes(c.label),
								),
								...row.capabilities.filter(
									(c) => !pinnedLabels.includes(c.label),
								),
							];
							const visible = ordered.slice(0, 4);
							const overflow = ordered.slice(4);
							return (
								<div className="flex justify-center gap-1">
									{visible.map(({ icon: Icon, label, color }) => (
										<div key={label} className="p-0.5" title={label}>
											<Icon className={`h-4 w-4 ${color}`} />
										</div>
									))}
									{overflow.length > 0 && (
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													className="p-0.5 text-xs font-medium text-muted-foreground"
													onClick={(e) => e.stopPropagation()}
												>
													+{overflow.length}
												</button>
											</TooltipTrigger>
											<TooltipContent>
												<div className="flex flex-col gap-1 text-xs">
													{overflow.map(({ icon: Icon, label }) => (
														<span
															className="flex items-center gap-1.5"
															key={label}
														>
															<Icon className="h-4 w-4 text-background" />
															{label}
														</span>
													))}
												</div>
											</TooltipContent>
										</Tooltip>
									)}
								</div>
							);
						})()}
					</TableCell>
				</TableRow>

				{/* Expanded row for additional pricing */}
				{isExpanded && row.hasAdditionalPricing && (
					<TableRow className="bg-muted/30">
						<TableCell colSpan={6} className="py-3">
							<div className="pl-8">
								<div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
									Additional Pricing
								</div>
								<div className="flex gap-3">
									{row.provider.webSearch && (
										<Badge
											variant="outline"
											className="text-sm px-3 py-1.5 bg-background"
										>
											<Globe className="h-4 w-4 mr-2 text-purple-500" />
											Web Search
											{row.provider.webSearchPrice &&
												parseFloat(row.provider.webSearchPrice) > 0 &&
												` $${parseFloat(row.provider.webSearchPrice).toFixed(3)}/search`}
										</Badge>
									)}
									{row.provider.requestPrice &&
										parseFloat(row.provider.requestPrice) > 0 && (
											<Badge
												variant="outline"
												className="text-sm px-3 py-1.5 bg-background"
											>
												Per Request $
												{parseFloat(row.provider.requestPrice).toFixed(3)}
											</Badge>
										)}
									{row.provider.perSecondPrice &&
										Object.keys(row.provider.perSecondPrice).length > 0 && (
											<Badge
												variant="outline"
												className="text-sm px-3 py-1.5 bg-background"
											>
												<Video className="h-4 w-4 mr-2 text-violet-500" />
												Video{" "}
												{(() => {
													const prices = row.provider.perSecondPrice!;
													const defaultVideo = prices["default_video"];
													const defaultAudio = prices["default_audio"];
													const defaultPrice = prices["default"];
													if (defaultVideo && defaultAudio) {
														return `$${defaultVideo} – $${defaultAudio}/sec`;
													}
													if (defaultPrice) {
														return `$${defaultPrice}/sec`;
													}
													const firstValue = Object.values(prices)[0];
													return firstValue ? `$${firstValue}/sec` : "";
												})()}
											</Badge>
										)}
									{row.provider.perImagePrice &&
										Object.keys(row.provider.perImagePrice).length > 0 && (
											<Badge
												variant="outline"
												className="text-sm px-3 py-1.5 bg-background"
											>
												Per Image{" "}
												{formatPerImagePriceRange(
													row.provider.perImagePrice!,
													row.provider.discount,
												) ?? ""}
											</Badge>
										)}
								</div>
							</div>
						</TableCell>
					</TableRow>
				)}
			</>
		);
	},
);

const MODELS_PER_PAGE = 50;

export function AllModels({
	children,
	models,
	providers,
	title,
	description,
	categoryFilter,
	seoContent,
	footer,
	renderCta,
	modelHrefBase = "",
	showPricingTierFilter = false,
	defaultCategory = "all",
	hideUseCaseFilter = false,
	hideHeader = false,
}: AllModelsProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const isMobile = useIsMobile();

	const modelHref = (path: string) => `${modelHrefBase}${path}`;

	const [viewMode, setViewMode] = useState<"table" | "grid">(
		(searchParams.get("view") as "table" | "grid") === "grid"
			? "grid"
			: "table",
	);

	useEffect(() => {
		const viewParam = searchParams.get("view");
		if (!viewParam && isMobile && viewMode !== "grid") {
			setViewMode("grid");
		}
	}, [isMobile, searchParams, viewMode]);

	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
	const [copiedModel, setCopiedModel] = useState<string | null>(null);

	// Search and filter states
	const [searchQuery, setSearchQuery] = useState(searchParams.get("q") ?? "");
	const [showFilters, setShowFilters] = useState(
		searchParams.get("filters") === "1",
	);

	// Sorting states
	const sortFieldParam = searchParams.get("sortField") as SortField | null;
	const sortDirParam = searchParams.get("sortDir");
	const discountedDefault =
		categoryFilter === "discounted" && !sortFieldParam && !sortDirParam;
	const [sortField, setSortField] = useState<SortField | null>(
		sortFieldParam || (discountedDefault ? "discount" : null),
	);
	const [sortDirection, setSortDirection] = useState<SortDirection>(
		sortDirParam === "desc" || sortDirParam === "asc"
			? sortDirParam
			: discountedDefault
				? "desc"
				: "asc",
	);
	const urlCategory = searchParams.get("category");

	// The status chips are single-select: `?status=` holds at most one value.
	// Legacy `?deactivated=true` links map onto the Deactivated chip so old
	// URLs keep working. No param means the default view (no status filter).
	function getStatusFilterFromUrl(
		searchParams: URLSearchParams,
	): ModelMappingStatus | null {
		const status = searchParams.get("status");
		if (status && isModelMappingStatus(status)) {
			return status;
		}
		return searchParams.get("deactivated") === "true" ? "deactivated" : null;
	}

	const [filters, setFilters] = useState({
		// With the selector hidden there is no way to see or change the
		// category, so ignore any URL override and pin the default. When the
		// selector is shown, only accept a known category from the URL so an
		// unsupported value falls back to the default instead of silently
		// matching every row.
		category: hideUseCaseFilter
			? defaultCategory
			: isUseCaseCategory(urlCategory)
				? urlCategory
				: defaultCategory,
		tier: searchParams.get("tier") ?? "all",
		capabilities: {
			streaming: searchParams.get("streaming") === "true",
			vision: searchParams.get("vision") === "true",
			tools: searchParams.get("tools") === "true",
			reasoning: searchParams.get("reasoning") === "true",
			reasoningBudget: searchParams.get("reasoningBudget") === "true",
			jsonOutput: searchParams.get("jsonOutput") === "true",
			jsonOutputSchema: searchParams.get("jsonOutputSchema") === "true",
			imageGeneration: searchParams.get("imageGeneration") === "true",
			videoGeneration: searchParams.get("videoGeneration") === "true",
			audioGeneration: searchParams.get("audioGeneration") === "true",
			embedding: searchParams.get("embedding") === "true",
			rerank: searchParams.get("rerank") === "true",
			webSearch: searchParams.get("webSearch") === "true",
			free: searchParams.get("free") === "true",
			discounted: searchParams.get("discounted") === "true",
		},
		selectedProvider: searchParams.get("provider") ?? "all",
		status: getStatusFilterFromUrl(searchParams),
		source: searchParams.get("source") ?? "all",
		eligibleOnly: searchParams.get("eligibility") === "eligible",
		inputPrice: {
			min: searchParams.get("inputPriceMin") ?? "",
			max: searchParams.get("inputPriceMax") ?? "",
		},
		outputPrice: {
			min: searchParams.get("outputPriceMin") ?? "",
			max: searchParams.get("outputPriceMax") ?? "",
		},
		contextSize: {
			min: searchParams.get("contextSizeMin") ?? "",
			max: searchParams.get("contextSizeMax") ?? "",
		},
	});

	// Org-directory extensions: the Source and Eligibility filters only appear
	// when the surface actually mixes in custom models or compliance data.
	const hasCustomModels = useMemo(
		() => models.some((model) => model.source === "custom"),
		[models],
	);
	const hasBlockedMappings = useMemo(
		() =>
			models.some((model) =>
				model.mappings.some((mapping) => mapping.blockedReasons?.length),
			),
		[models],
	);

	const updateUrlWithFilters = useCallback(
		(newParams: Record<string, string | undefined>) => {
			const params = new URLSearchParams(searchParams.toString());
			Object.entries(newParams).forEach(([key, value]) => {
				if (value !== undefined && value !== "") {
					params.set(key, value);
				} else {
					params.delete(key);
				}
			});
			router.replace(`?${params.toString()}`, { scroll: false });
		},
		[router, searchParams],
	);

	const setStatusFilter = useCallback(
		(status: ModelMappingStatus | null) => {
			setFilters((prev) => ({ ...prev, status }));
			updateUrlWithFilters({
				status: status ?? undefined,
				deactivated: undefined,
				page: undefined,
			});
		},
		[updateUrlWithFilters],
	);

	// Calculate total counts (excluding deprecated and deactivated models)
	const { totalModelCount, totalProviderCount } = useMemo(() => {
		const now = new Date();

		// Count models that have at least one visible mapping
		const visibleModelCount = models.filter((model) =>
			model.mappings.some((mapping) =>
				isVisibleMapping(
					mapping,
					{
						status: filters.status,
						showDeactivated: false,
						eligibleOnly: filters.eligibleOnly,
					},
					now,
				),
			),
		).length;

		return {
			totalModelCount: visibleModelCount,
			totalProviderCount: providers.length,
		};
	}, [models, providers, filters.status, filters.eligibleOnly]);

	const modelsWithProviders: ModelWithProviders[] = useMemo(() => {
		const now = new Date();

		const baseModels = models
			.filter((model) => {
				if (filters.source === "custom") {
					return model.source === "custom";
				}
				if (filters.source === "catalog") {
					return model.source !== "custom";
				}
				return true;
			})
			.map((model) => {
				// Filter out deprecated provider mappings, plus deactivated ones
				// unless the visitor opted into seeing them; with a status chip
				// active only mappings of exactly that status remain
				const visibleMappings = model.mappings.filter((mapping) =>
					isVisibleMapping(
						mapping,
						{
							status: filters.status,
							showDeactivated: false,
							eligibleOnly: filters.eligibleOnly,
						},
						now,
					),
				);

				return {
					...model,
					providerDetails: visibleMappings.map((mapping) => ({
						provider: mapping,
						providerInfo: providers.find((p) => p.id === mapping.providerId)!,
					})),
				};
			})
			// Filter out models with no visible provider mappings
			.filter((model) => model.providerDetails.length > 0);

		// Apply category pre-filter if provided
		const preFilteredModels = categoryFilter
			? baseModels.filter((model) =>
					applyCategoryFilter(
						categoryFilter,
						model,
						model.providerDetails.map((p) => p.provider),
					),
				)
			: baseModels;

		const filteredModels = preFilteredModels.filter((model) => {
			// Improved fuzzy search: token-based, accent-insensitive, ignores punctuation
			if (searchQuery) {
				const normalize = (str: string) =>
					str
						.toLowerCase()
						.normalize("NFD")
						.replace(/[\u0300-\u036f]/g, "") // strip accents
						.replace(/[^a-z0-9]/g, "");

				const queryTokens = searchQuery
					.trim()
					.toLowerCase()
					.split(/\s+/)
					.map((t: string) => t.replace(/[^a-z0-9]/g, ""))
					.filter(Boolean);

				const providerStrings = (model.providerDetails ?? []).flatMap((p) => [
					p.provider.providerId,
					p.providerInfo?.name ?? "",
				]);
				const haystackParts = [
					model.name ?? "",
					model.id,
					model.family,
					...(model.aliases ?? []),
					...providerStrings,
				];
				const haystack = normalize(haystackParts.join(" "));
				const normalizedQuery = normalize(searchQuery);

				const containsAllTokens = queryTokens.every((t: string) =>
					haystack.includes(t),
				);
				const containsPhrase = normalizedQuery
					? haystack.includes(normalizedQuery)
					: true;

				if (!(containsAllTokens || containsPhrase)) {
					return false;
				}
			}

			// Use Case filter (chat/reasoning/creative/image/multimodal/code) —
			// a model qualifies via any one of its mappings.
			if (
				filters.category &&
				filters.category !== "all" &&
				!applyUseCaseFilter(
					filters.category,
					model,
					model.providerDetails.map((p) => p.provider),
				)
			) {
				return false;
			}

			// Pricing tier filter: premium is the fair-use category enforced by
			// the gateway ($5+/M input or $15+/M output), standard is the rest
			if (filters.tier === "premium" && !model.premium) {
				return false;
			}
			if (filters.tier === "standard" && model.premium) {
				return false;
			}

			// Capability filters
			if (
				filters.capabilities.streaming &&
				!model.providerDetails.some((p) =>
					matchesCapability("streaming", p.provider),
				)
			) {
				return false;
			}
			if (
				filters.capabilities.vision &&
				!model.providerDetails.some((p) =>
					matchesCapability("vision", p.provider),
				)
			) {
				return false;
			}
			if (
				filters.capabilities.tools &&
				!model.providerDetails.some((p) =>
					matchesCapability("tools", p.provider),
				)
			) {
				return false;
			}
			if (
				filters.capabilities.reasoning &&
				!model.providerDetails.some((p) =>
					matchesCapability("reasoning", p.provider),
				)
			) {
				return false;
			}
			if (
				filters.capabilities.reasoningBudget &&
				!model.providerDetails.some((p) =>
					matchesCapability("reasoningMaxTokens", p.provider),
				)
			) {
				return false;
			}
			if (
				filters.capabilities.jsonOutput &&
				!model.providerDetails.some((p) =>
					matchesCapability("jsonOutput", p.provider),
				)
			) {
				return false;
			}
			if (
				filters.capabilities.jsonOutputSchema &&
				!model.providerDetails.some((p) =>
					matchesCapability("jsonOutputSchema", p.provider),
				)
			) {
				return false;
			}
			if (
				filters.capabilities.imageGeneration &&
				!model.output?.includes("image")
			) {
				return false;
			}
			if (
				filters.capabilities.videoGeneration &&
				!model.output?.includes("video")
			) {
				return false;
			}
			if (
				filters.capabilities.audioGeneration &&
				!model.output?.includes("audio")
			) {
				return false;
			}
			if (
				filters.capabilities.embedding &&
				!model.output?.includes("embedding")
			) {
				return false;
			}
			if (filters.capabilities.rerank && !model.output?.includes("rerank")) {
				return false;
			}
			if (
				filters.capabilities.webSearch &&
				!model.providerDetails.some((p) =>
					matchesCapability("webSearch", p.provider),
				)
			) {
				return false;
			}
			if (filters.capabilities.free) {
				// A model is only considered free if it has the free flag AND no
				// provider bills per request, per generated image, or per second
				// (mirrors the gateway's isModelTrulyFree definition).
				const hasNonTokenPrice = model.providerDetails.some(
					(p) =>
						(p.provider.requestPrice &&
							parseFloat(p.provider.requestPrice) > 0) ||
						(p.provider.perImagePrice &&
							Object.keys(p.provider.perImagePrice).length > 0) ||
						(p.provider.perSecondPrice &&
							Object.keys(p.provider.perSecondPrice).length > 0),
				);
				if (!model.free || hasNonTokenPrice) {
					return false;
				}
			}
			if (
				filters.capabilities.discounted &&
				!model.providerDetails.some((p) =>
					matchesCapability("discounted", p.provider),
				)
			) {
				return false;
			}

			// Provider filter
			if (filters.selectedProvider && filters.selectedProvider !== "all") {
				const hasSelectedProvider = model.providerDetails.some(
					(p) => p.provider.providerId === filters.selectedProvider,
				);
				if (!hasSelectedProvider) {
					return false;
				}
			}

			// Price filters
			const hasInputPrice = (min: string, max: string) => {
				return model.providerDetails.some((p) => {
					if (
						p.provider.inputPrice === null ||
						p.provider.inputPrice === undefined
					) {
						return !min && !max;
					}
					const price = parseFloat(p.provider.inputPrice) * 1e6; // Convert to per million tokens
					const minPrice = min ? parseFloat(min) : 0;
					const maxPrice = max ? parseFloat(max) : Infinity;
					return price >= minPrice && price <= maxPrice;
				});
			};

			const hasOutputPrice = (min: string, max: string) => {
				return model.providerDetails.some((p) => {
					if (
						p.provider.outputPrice === null ||
						p.provider.outputPrice === undefined
					) {
						return !min && !max;
					}
					const price = parseFloat(p.provider.outputPrice) * 1e6; // Convert to per million tokens
					const minPrice = min ? parseFloat(min) : 0;
					const maxPrice = max ? parseFloat(max) : Infinity;
					return price >= minPrice && price <= maxPrice;
				});
			};

			const hasContextSize = (min: string, max: string) => {
				return model.providerDetails.some((p) => {
					if (
						p.provider.contextSize === null ||
						p.provider.contextSize === undefined
					) {
						return !min && !max;
					}
					const size = p.provider.contextSize;
					const minSize = min ? parseInt(min, 10) : 0;
					const maxSize = max ? parseInt(max, 10) : Infinity;
					return size >= minSize && size <= maxSize;
				});
			};

			if (
				(filters.inputPrice.min || filters.inputPrice.max) &&
				!hasInputPrice(filters.inputPrice.min, filters.inputPrice.max)
			) {
				return false;
			}
			if (
				(filters.outputPrice.min || filters.outputPrice.max) &&
				!hasOutputPrice(filters.outputPrice.min, filters.outputPrice.max)
			) {
				return false;
			}
			if (
				(filters.contextSize.min || filters.contextSize.max) &&
				!hasContextSize(filters.contextSize.min, filters.contextSize.max)
			) {
				return false;
			}

			return true;
		});

		// Apply sorting - default to createdAt (falls back to releasedAt) descending (newest first)
		return [...filteredModels].sort((a, b) => {
			// Default sorting by createdAt, fallback to releasedAt, when no sort field selected
			if (!sortField) {
				const aDate = a.createdAt
					? new Date(a.createdAt).getTime()
					: a.releasedAt
						? new Date(a.releasedAt).getTime()
						: 0;
				const bDate = b.createdAt
					? new Date(b.createdAt).getTime()
					: b.releasedAt
						? new Date(b.releasedAt).getTime()
						: 0;
				return bDate - aDate; // Descending (newest first)
			}

			let aValue: string | number;
			let bValue: string | number;

			switch (sortField) {
				case "provider":
					// For grid view, sort by first provider name
					aValue = (
						a.providerDetails[0]?.providerInfo?.name ??
						a.providerDetails[0]?.provider.providerId ??
						""
					).toLowerCase();
					bValue = (
						b.providerDetails[0]?.providerInfo?.name ??
						b.providerDetails[0]?.provider.providerId ??
						""
					).toLowerCase();
					break;
				case "name":
					aValue = (a.name ?? a.id).toLowerCase();
					bValue = (b.name ?? b.id).toLowerCase();
					break;
				case "inputPrice": {
					// Get the min input price among all providers for this model
					const aInputPrices = a.providerDetails
						.map((p) => p.provider.inputPrice)
						.filter((p): p is string => p !== null && p !== undefined)
						.map((p) => parseFloat(p));
					const bInputPrices = b.providerDetails
						.map((p) => p.provider.inputPrice)
						.filter((p): p is string => p !== null && p !== undefined)
						.map((p) => parseFloat(p));
					aValue =
						aInputPrices.length > 0 ? Math.min(...aInputPrices) : Infinity;
					bValue =
						bInputPrices.length > 0 ? Math.min(...bInputPrices) : Infinity;
					break;
				}
				case "outputPrice": {
					// Get the min output price among all providers for this model
					const aOutputPrices = a.providerDetails
						.map((p) => p.provider.outputPrice)
						.filter((p): p is string => p !== null && p !== undefined)
						.map((p) => parseFloat(p));
					const bOutputPrices = b.providerDetails
						.map((p) => p.provider.outputPrice)
						.filter((p): p is string => p !== null && p !== undefined)
						.map((p) => parseFloat(p));
					aValue =
						aOutputPrices.length > 0 ? Math.min(...aOutputPrices) : Infinity;
					bValue =
						bOutputPrices.length > 0 ? Math.min(...bOutputPrices) : Infinity;
					break;
				}
				case "cachedInputPrice": {
					// Get the min cached input price among all providers for this model
					const aCachedInputPrices = a.providerDetails
						.map((p) => p.provider.cachedInputPrice)
						.filter((p): p is string => p !== null && p !== undefined)
						.map((p) => parseFloat(p));
					const bCachedInputPrices = b.providerDetails
						.map((p) => p.provider.cachedInputPrice)
						.filter((p): p is string => p !== null && p !== undefined)
						.map((p) => parseFloat(p));
					aValue =
						aCachedInputPrices.length > 0
							? Math.min(...aCachedInputPrices)
							: Infinity;
					bValue =
						bCachedInputPrices.length > 0
							? Math.min(...bCachedInputPrices)
							: Infinity;
					break;
				}
				case "discount": {
					// Highest discount across all providers for this model
					const aDiscounts = a.providerDetails.map((m) =>
						discountFraction(m.provider.discount),
					);
					const bDiscounts = b.providerDetails.map((m) =>
						discountFraction(m.provider.discount),
					);
					aValue = aDiscounts.length > 0 ? Math.max(...aDiscounts) : 0;
					bValue = bDiscounts.length > 0 ? Math.max(...bDiscounts) : 0;
					break;
				}
				default:
					return 0;
			}

			if (aValue < bValue) {
				return sortDirection === "asc" ? -1 : 1;
			}
			if (aValue > bValue) {
				return sortDirection === "asc" ? 1 : -1;
			}
			return 0;
		});
	}, [
		searchQuery,
		filters,
		sortField,
		sortDirection,
		models,
		providers,
		categoryFilter,
	]);

	// Calculate unique filtered providers
	const filteredProviderCount = useMemo(() => {
		const uniqueProviders = new Set(
			modelsWithProviders.flatMap((model) =>
				model.providerDetails.map((p) => p.provider.providerId),
			),
		);
		return uniqueProviders.size;
	}, [modelsWithProviders]);

	// Flattened rows for table view (one row per provider-model combination)
	// Pre-compute capabilities and provider icons for performance
	const flattenedRows: FlattenedModelRow[] = useMemo(() => {
		const rows: FlattenedModelRow[] = [];
		const providerFilter =
			filters.selectedProvider && filters.selectedProvider !== "all"
				? filters.selectedProvider
				: null;

		for (const model of modelsWithProviders) {
			for (const { provider, providerInfo } of model.providerDetails) {
				// Single source of truth for which rows belong in the filtered
				// table: provider, capability, category, and use-case filters
				// are all re-checked per row here (the same code the tests
				// exercise), so a mapping that qualifies a model at the model
				// level but fails an active filter is kept out of the table.
				if (
					!providerRowPassesFilters(model, provider, {
						providerFilter,
						capabilities: filters.capabilities,
						categoryFilter,
						category: filters.category,
					})
				) {
					continue;
				}

				const hasAdditionalPricing =
					provider.webSearch === true ||
					(provider.requestPrice !== null &&
						provider.requestPrice !== undefined &&
						parseFloat(provider.requestPrice) > 0) ||
					(provider.perSecondPrice !== null &&
						provider.perSecondPrice !== undefined &&
						Object.values(provider.perSecondPrice).some(
							(price) => parseFloat(price) > 0,
						)) ||
					(provider.perImagePrice !== null &&
						provider.perImagePrice !== undefined &&
						Object.values(provider.perImagePrice).some(
							(price) => parseFloat(price) > 0,
						));

				rows.push({
					model,
					provider,
					providerInfo,
					hasAdditionalPricing,
					rowKey: `${provider.providerId}-${model.id}-${provider.region ?? ""}`,
					capabilities: computeCapabilities(provider, model),
					ProviderIcon: getProviderIcon(provider.providerId),
				});
			}
		}

		// Sort flattened rows
		return rows.sort((a, b) => {
			if (!sortField) {
				// Default: sort by createdAt (falls back to releasedAt) descending (newest first)
				const aDate = a.model.createdAt
					? new Date(a.model.createdAt).getTime()
					: a.model.releasedAt
						? new Date(a.model.releasedAt).getTime()
						: 0;
				const bDate = b.model.createdAt
					? new Date(b.model.createdAt).getTime()
					: b.model.releasedAt
						? new Date(b.model.releasedAt).getTime()
						: 0;
				return bDate - aDate;
			}

			let aValue: string | number;
			let bValue: string | number;

			switch (sortField) {
				case "provider":
					aValue = (
						a.providerInfo?.name ?? a.provider.providerId
					).toLowerCase();
					bValue = (
						b.providerInfo?.name ?? b.provider.providerId
					).toLowerCase();
					break;
				case "name":
					aValue = (a.model.name ?? a.model.id).toLowerCase();
					bValue = (b.model.name ?? b.model.id).toLowerCase();
					break;
				case "inputPrice": {
					const aPrice = a.provider.inputPrice;
					const bPrice = b.provider.inputPrice;
					aValue =
						aPrice !== null && aPrice !== undefined
							? parseFloat(aPrice)
							: Infinity;
					bValue =
						bPrice !== null && bPrice !== undefined
							? parseFloat(bPrice)
							: Infinity;
					break;
				}
				case "outputPrice": {
					const aPrice = a.provider.outputPrice;
					const bPrice = b.provider.outputPrice;
					aValue =
						aPrice !== null && aPrice !== undefined
							? parseFloat(aPrice)
							: Infinity;
					bValue =
						bPrice !== null && bPrice !== undefined
							? parseFloat(bPrice)
							: Infinity;
					break;
				}
				case "cachedInputPrice": {
					const aPrice = a.provider.cachedInputPrice;
					const bPrice = b.provider.cachedInputPrice;
					aValue =
						aPrice !== null && aPrice !== undefined
							? parseFloat(aPrice)
							: Infinity;
					bValue =
						bPrice !== null && bPrice !== undefined
							? parseFloat(bPrice)
							: Infinity;
					break;
				}
				case "discount":
					aValue = discountFraction(a.provider.discount);
					bValue = discountFraction(b.provider.discount);
					break;
				default:
					return 0;
			}

			if (aValue < bValue) {
				return sortDirection === "asc" ? -1 : 1;
			}
			if (aValue > bValue) {
				return sortDirection === "asc" ? 1 : -1;
			}
			return 0;
		});
	}, [modelsWithProviders, sortField, sortDirection, filters.selectedProvider]);

	const hasActiveFilters =
		categoryFilter ||
		searchQuery ||
		(filters.category && filters.category !== defaultCategory) ||
		(filters.tier && filters.tier !== "all") ||
		Object.values(filters.capabilities).some(Boolean) ||
		(filters.selectedProvider && filters.selectedProvider !== "all") ||
		filters.status !== null ||
		(filters.source && filters.source !== "all") ||
		filters.eligibleOnly ||
		filters.inputPrice.min ||
		filters.inputPrice.max ||
		filters.outputPrice.min ||
		filters.outputPrice.max ||
		filters.contextSize.min ||
		filters.contextSize.max;

	// Pagination
	const currentPage = Math.max(
		1,
		Math.floor(Number(searchParams.get("page")) || 1),
	);
	const totalTablePages = Math.ceil(flattenedRows.length / MODELS_PER_PAGE);
	const totalGridPages = Math.ceil(
		modelsWithProviders.length / MODELS_PER_PAGE,
	);
	const totalPages = viewMode === "table" ? totalTablePages : totalGridPages;
	const safePage = Math.min(currentPage, Math.max(1, totalPages));

	useEffect(() => {
		if (currentPage !== safePage) {
			updateUrlWithFilters({
				page: safePage > 1 ? String(safePage) : undefined,
			});
		}
	}, [currentPage, safePage, updateUrlWithFilters]);

	const paginatedFlattenedRows = flattenedRows.slice(
		(safePage - 1) * MODELS_PER_PAGE,
		safePage * MODELS_PER_PAGE,
	);

	const paginatedModels = modelsWithProviders.slice(
		(safePage - 1) * MODELS_PER_PAGE,
		safePage * MODELS_PER_PAGE,
	);

	const goToPage = useCallback(
		(page: number) => {
			updateUrlWithFilters({
				page: page > 1 ? String(page) : undefined,
			});
			window.scrollTo({ top: 0, behavior: "smooth" });
		},
		[updateUrlWithFilters],
	);

	const buildPageUrl = useCallback(
		(page: number) => {
			const params = new URLSearchParams(searchParams.toString());
			if (page > 1) {
				params.set("page", String(page));
			} else {
				params.delete("page");
			}
			const qs = params.toString();
			return `${pathname}${qs ? `?${qs}` : ""}`;
		},
		[pathname, searchParams],
	);

	// Toggle expanded row
	const toggleRowExpanded = useCallback((rowKey: string) => {
		setExpandedRows((prev) => {
			const next = new Set(prev);
			if (next.has(rowKey)) {
				next.delete(rowKey);
			} else {
				next.add(rowKey);
			}
			return next;
		});
	}, []);

	const copyToClipboard = useCallback(
		async (text: string, key: string, e: React.MouseEvent) => {
			e.stopPropagation();
			try {
				await navigator.clipboard.writeText(text);
				setCopiedModel(key);
				setTimeout(() => setCopiedModel(null), 2000);
			} catch (err) {
				console.error("Failed to copy text:", err);
			}
		},
		[],
	);

	const handleSort = (field: SortField) => {
		if (sortField === field) {
			const newDir: SortDirection = sortDirection === "asc" ? "desc" : "asc";
			setSortDirection(newDir);
			updateUrlWithFilters({ sortDir: newDir });
		} else {
			setSortField(field);
			setSortDirection("asc");
			updateUrlWithFilters({ sortField: field, sortDir: "asc" });
		}
	};

	const getSortIcon = (field: SortField) => {
		if (sortField !== field) {
			return <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />;
		}
		return sortDirection === "asc" ? (
			<ArrowUp className="ml-2 h-4 w-4 text-primary" />
		) : (
			<ArrowDown className="ml-2 h-4 w-4 text-primary" />
		);
	};

	const shouldShowStabilityWarning = (
		stability?: StabilityLevel | null,
	): boolean => {
		return (
			stability !== null &&
			stability !== undefined &&
			["unstable", "experimental"].includes(stability)
		);
	};

	const formatPrice = (
		price: string | null | undefined,
		discount?: string | null,
	) => {
		if (price === null || price === undefined) {
			return "—";
		}
		const priceNum = parseFloat(price);
		const discountNum = discount ? parseFloat(discount) : 0;
		const originalPrice = (priceNum * 1e6).toFixed(2);
		if (discountNum > 0) {
			const discountedPrice = (priceNum * 1e6 * (1 - discountNum)).toFixed(2);
			return (
				<div className="flex flex-col items-end">
					<div className="flex items-center gap-1">
						<span className="line-through text-muted-foreground text-xs">
							${originalPrice}
						</span>
						<span className="text-green-600 font-semibold">
							${discountedPrice}
						</span>
					</div>
					<span className="text-[10px] text-green-600">
						-{Math.round(discountNum * 100)}% off
					</span>
				</div>
			);
		}
		return `$${originalPrice}`;
	};

	const getCapabilityIcons = computeCapabilities;

	const clearFilters = () => {
		setSearchQuery("");
		setFilters({
			category: defaultCategory,
			tier: "all",
			capabilities: {
				streaming: false,
				vision: false,
				tools: false,
				reasoning: false,
				reasoningBudget: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				imageGeneration: false,
				videoGeneration: false,
				audioGeneration: false,
				embedding: false,
				rerank: false,
				webSearch: false,
				free: false,
				discounted: false,
			},
			selectedProvider: "all",
			status: null,
			source: "all",
			eligibleOnly: false,
			inputPrice: { min: "", max: "" },
			outputPrice: { min: "", max: "" },
			contextSize: { min: "", max: "" },
		});
		setSortField(null);
		setSortDirection("asc");

		updateUrlWithFilters({
			q: undefined,
			category: undefined,
			tier: undefined,
			streaming: undefined,
			vision: undefined,
			tools: undefined,
			reasoning: undefined,
			reasoningBudget: undefined,
			jsonOutput: undefined,
			jsonOutputSchema: undefined,
			imageGeneration: undefined,
			videoGeneration: undefined,
			audioGeneration: undefined,
			embedding: undefined,
			webSearch: undefined,
			free: undefined,
			discounted: undefined,
			provider: undefined,
			status: undefined,
			deactivated: undefined,
			source: undefined,
			eligibility: undefined,
			inputPriceMin: undefined,
			inputPriceMax: undefined,
			outputPriceMin: undefined,
			outputPriceMax: undefined,
			contextSizeMin: undefined,
			contextSizeMax: undefined,
			sortField: undefined,
			sortDir: undefined,
		});
	};

	const renderFilters = () => (
		<Card
			className={`transition-all duration-200 ${showFilters ? "opacity-100" : "opacity-0 hidden"}`}
		>
			<CardContent className="pt-6">
				<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
					{/* Categories */}
					<div className="space-y-3">
						{!hideUseCaseFilter && (
							<>
								<div className="font-medium text-sm">Use Case</div>
								<Select
									value={filters.category}
									onValueChange={(value) => {
										setFilters((prev) => ({ ...prev, category: value }));
										updateUrlWithFilters({
											category: value !== defaultCategory ? value : undefined,
										});
									}}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="All Use Cases" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">
											<div className="flex items-center gap-2">
												<List className="h-4 w-4 text-muted-foreground" />
												All Use Cases
											</div>
										</SelectItem>
										<SelectItem value="code">
											<div className="flex items-center gap-2">
												<Code className="h-4 w-4 text-indigo-500" />
												Code Generation
											</div>
										</SelectItem>
										<SelectItem value="chat">
											<div className="flex items-center gap-2">
												<Bot className="h-4 w-4 text-blue-500" />
												Chat & Assistants
											</div>
										</SelectItem>
										<SelectItem value="reasoning">
											<div className="flex items-center gap-2">
												<Brain className="h-4 w-4 text-orange-500" />
												Reasoning & Analysis
											</div>
										</SelectItem>
										<SelectItem value="creative">
											<div className="flex items-center gap-2">
												<PenTool className="h-4 w-4 text-purple-500" />
												Creative & Writing
											</div>
										</SelectItem>
										<SelectItem value="image">
											<div className="flex items-center gap-2">
												<ImagePlus className="h-4 w-4 text-pink-500" />
												Image Generation
											</div>
										</SelectItem>
										<SelectItem value="multimodal">
											<div className="flex items-center gap-2">
												<Sparkles className="h-4 w-4 text-amber-500" />
												Multimodal (Vision)
											</div>
										</SelectItem>
									</SelectContent>
								</Select>
							</>
						)}

						{showPricingTierFilter ? (
							<>
								{/* Pricing tier — stacked under Use Case (or standing in
								    for it when that select is hidden) to keep the filter
								    grid on a single row */}
								<div className="font-medium text-sm">
									Pricing Tier (DevPass)
								</div>
								<Select
									value={filters.tier}
									onValueChange={(value) => {
										setFilters((prev) => ({ ...prev, tier: value }));
										updateUrlWithFilters({
											tier: value !== "all" ? value : undefined,
										});
									}}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="All Tiers" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">
											<div className="flex items-center gap-2">
												<List className="h-4 w-4 text-muted-foreground" />
												All Tiers
											</div>
										</SelectItem>
										<SelectItem value="premium">
											<div className="flex items-center gap-2">
												<Gem className="h-4 w-4 text-amber-500" />
												Premium
											</div>
										</SelectItem>
										<SelectItem value="standard">
											<div className="flex items-center gap-2">
												<Zap className="h-4 w-4 text-emerald-500" />
												Standard
											</div>
										</SelectItem>
									</SelectContent>
								</Select>
							</>
						) : null}
					</div>

					{/* Capabilities */}
					<div className="space-y-3">
						<div className="font-medium text-sm">Capabilities</div>
						<div className="flex flex-wrap gap-2">
							{[
								{
									key: "streaming",
									label: "Streaming",
									icon: Zap,
									color: "text-blue-500",
								},
								{
									key: "vision",
									label: "Vision",
									icon: Eye,
									color: "text-green-500",
								},
								{
									key: "tools",
									label: "Tools",
									icon: Wrench,
									color: "text-purple-500",
								},
								{
									key: "reasoning",
									label: "Reasoning",
									icon: MessageSquare,
									color: "text-orange-500",
								},
								{
									key: "reasoningBudget",
									label: "Reasoning Budget",
									icon: Sliders,
									color: "text-amber-500",
								},
								{
									key: "jsonOutput",
									label: "JSON",
									icon: Braces,
									color: "text-cyan-500",
								},
								{
									key: "jsonOutputSchema",
									label: "Structured JSON",
									icon: FileJson2,
									color: "text-teal-500",
								},
								{
									key: "imageGeneration",
									label: "Image Gen",
									icon: ImagePlus,
									color: "text-pink-500",
								},
								{
									key: "videoGeneration",
									label: "Video Gen",
									icon: Video,
									color: "text-violet-500",
								},
								{
									key: "audioGeneration",
									label: "Speech Gen",
									icon: Volume2,
									color: "text-rose-500",
								},
								{
									key: "embedding",
									label: "Embeddings",
									icon: Boxes,
									color: "text-indigo-500",
								},
								{
									key: "rerank",
									label: "Rerank",
									icon: ListOrdered,
									color: "text-amber-500",
								},
								{
									key: "webSearch",
									label: "Web Search",
									icon: Globe,
									color: "text-sky-500",
								},
								{
									key: "free",
									label: "Free",
									icon: Gift,
									color: "text-emerald-500",
								},
								{
									key: "discounted",
									label: "Discounted",
									icon: Percent,
									color: "text-red-500",
								},
							].map(({ key, label, icon: Icon, color }) => (
								<Toggle
									key={`${key}-${label}`}
									variant="outline"
									size="sm"
									pressed={
										filters.capabilities[
											key as keyof typeof filters.capabilities
										]
									}
									onPressedChange={(pressed) => {
										setFilters((prev) => ({
											...prev,
											capabilities: {
												...prev.capabilities,
												[key]: pressed,
											},
										}));
										if (key === "discounted") {
											if (pressed) {
												setSortField("discount");
												setSortDirection("desc");
												updateUrlWithFilters({
													[key]: "true",
													sortField: "discount",
													sortDir: "desc",
												});
											} else {
												setSortField(null);
												setSortDirection("desc");
												updateUrlWithFilters({
													[key]: undefined,
													sortField: undefined,
													sortDir: undefined,
												});
											}
										} else {
											updateUrlWithFilters({
												[key]: pressed ? "true" : undefined,
											});
										}
									}}
									className="gap-1.5"
								>
									<Icon className={`h-3.5 w-3.5 ${color}`} />
									<span className="text-xs">{label}</span>
								</Toggle>
							))}
						</div>
					</div>

					<div className="space-y-3">
						<div className="font-medium text-sm">Provider</div>
						<Select
							value={filters.selectedProvider}
							onValueChange={(value) => {
								setFilters((prev) => ({
									...prev,
									selectedProvider: value,
								}));
								updateUrlWithFilters({
									provider: value === "all" ? undefined : value,
								});
							}}
						>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="All providers" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All providers</SelectItem>
								{providers.map((provider) => {
									const ProviderIcon = getProviderIcon(provider.id);
									return (
										<SelectItem
											key={`${provider.id}-${provider.name}`}
											value={provider.id}
										>
											<div className="flex items-center gap-2">
												{ProviderIcon && <ProviderIcon className="h-4 w-4" />}
												<span>{provider.name}</span>
											</div>
										</SelectItem>
									);
								})}
							</SelectContent>
						</Select>

						{hasCustomModels && (
							<>
								<div className="font-medium text-sm">Source</div>
								<Select
									value={filters.source}
									onValueChange={(value) => {
										setFilters((prev) => ({ ...prev, source: value }));
										updateUrlWithFilters({
											source: value === "all" ? undefined : value,
											page: undefined,
										});
									}}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="All models" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">
											<div className="flex items-center gap-2">
												<List className="h-4 w-4 text-muted-foreground" />
												Catalog & custom
											</div>
										</SelectItem>
										<SelectItem value="catalog">
											<div className="flex items-center gap-2">
												<Boxes className="h-4 w-4 text-indigo-500" />
												Catalog models
											</div>
										</SelectItem>
										<SelectItem value="custom">
											<div className="flex items-center gap-2">
												<Wrench className="h-4 w-4 text-emerald-500" />
												Custom models
											</div>
										</SelectItem>
									</SelectContent>
								</Select>
							</>
						)}

						<div className="font-medium text-sm">Status</div>
						<div className="flex flex-wrap gap-2">
							<Toggle
								variant="outline"
								size="sm"
								pressed={filters.status === "deactivated"}
								onPressedChange={(pressed) => {
									setStatusFilter(pressed ? "deactivated" : null);
								}}
								className="gap-1.5"
							>
								<AlertCircle className="h-3.5 w-3.5 text-red-500" />
								<span className="text-xs">Deactivated</span>
							</Toggle>
							<Toggle
								variant="outline"
								size="sm"
								pressed={filters.status === "scheduled"}
								onPressedChange={(pressed) => {
									setStatusFilter(pressed ? "scheduled" : null);
								}}
								className="gap-1.5"
							>
								<Clock className="h-3.5 w-3.5 text-amber-500" />
								<span className="text-xs">Scheduled</span>
							</Toggle>
							<Toggle
								variant="outline"
								size="sm"
								pressed={filters.status === "deprecated"}
								onPressedChange={(pressed) => {
									setStatusFilter(pressed ? "deprecated" : null);
								}}
								className="gap-1.5"
							>
								<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
								<span className="text-xs">Deprecated</span>
							</Toggle>
							<Toggle
								variant="outline"
								size="sm"
								pressed={filters.status === "active"}
								onPressedChange={(pressed) => {
									setStatusFilter(pressed ? "active" : null);
								}}
								className="gap-1.5"
							>
								<Check className="h-3.5 w-3.5 text-green-500" />
								<span className="text-xs">Active</span>
							</Toggle>
							{hasBlockedMappings && (
								<Toggle
									variant="outline"
									size="sm"
									pressed={filters.eligibleOnly}
									onPressedChange={(pressed) => {
										setFilters((prev) => ({ ...prev, eligibleOnly: pressed }));
										updateUrlWithFilters({
											eligibility: pressed ? "eligible" : undefined,
											page: undefined,
										});
									}}
									className="gap-1.5"
								>
									<Check className="h-3.5 w-3.5 text-emerald-500" />
									<span className="text-xs">Eligible only</span>
								</Toggle>
							)}
						</div>
					</div>

					<div className="space-y-3">
						<div className="font-medium text-sm">Input Price ($/M tokens)</div>
						<div className="space-y-2">
							<Input
								placeholder="Min price"
								type="number"
								value={filters.inputPrice.min}
								onChange={(e) => {
									const value = e.target.value;
									setFilters((prev) => ({
										...prev,
										inputPrice: { ...prev.inputPrice, min: value },
									}));
									updateUrlWithFilters({ inputPriceMin: value ?? undefined });
								}}
								className="h-8"
							/>
							<Input
								placeholder="Max price"
								type="number"
								value={filters.inputPrice.max}
								onChange={(e) => {
									const value = e.target.value;
									setFilters((prev) => ({
										...prev,
										inputPrice: { ...prev.inputPrice, max: value },
									}));
									updateUrlWithFilters({ inputPriceMax: value ?? undefined });
								}}
								className="h-8"
							/>
						</div>
					</div>

					<div className="space-y-3">
						<div className="font-medium text-sm">Output Price ($/M tokens)</div>
						<div className="space-y-2">
							<Input
								placeholder="Min price"
								type="number"
								value={filters.outputPrice.min}
								onChange={(e) => {
									const value = e.target.value;
									setFilters((prev) => ({
										...prev,
										outputPrice: { ...prev.outputPrice, min: value },
									}));
									updateUrlWithFilters({ outputPriceMin: value ?? undefined });
								}}
								className="h-8"
							/>
							<Input
								placeholder="Max price"
								type="number"
								value={filters.outputPrice.max}
								onChange={(e) => {
									const value = e.target.value;
									setFilters((prev) => ({
										...prev,
										outputPrice: { ...prev.outputPrice, max: value },
									}));
									updateUrlWithFilters({ outputPriceMax: value ?? undefined });
								}}
								className="h-8"
							/>
						</div>
					</div>

					<div className="space-y-3">
						<div className="font-medium text-sm">Context Size (tokens)</div>
						<div className="space-y-2">
							<Input
								placeholder="Min size (e.g., 128000)"
								type="number"
								value={filters.contextSize.min}
								onChange={(e) => {
									const value = e.target.value;
									setFilters((prev) => ({
										...prev,
										contextSize: { ...prev.contextSize, min: value },
									}));
									updateUrlWithFilters({ contextSizeMin: value ?? undefined });
								}}
								className="h-8"
							/>
							<Input
								placeholder="Max size (e.g., 200000)"
								type="number"
								value={filters.contextSize.max}
								onChange={(e) => {
									const value = e.target.value;
									setFilters((prev) => ({
										...prev,
										contextSize: { ...prev.contextSize, max: value },
									}));
									updateUrlWithFilters({ contextSizeMax: value ?? undefined });
								}}
								className="h-8"
							/>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);

	// Capability filter keys that are active, used to pin the matching icon to
	// the front of the features column in the table view.
	const pinnedCapabilityKeys = useMemo(
		() =>
			(
				Object.entries(filters.capabilities) as Array<
					[keyof typeof filters.capabilities, boolean]
				>
			)
				.filter(([, pressed]) => pressed)
				.map(([key]) => key)
				.filter((key) => CAPABILITY_LABEL_BY_FILTER_KEY[key]),
		[filters.capabilities],
	);

	const renderTableView = () => {
		return (
			<div className="rounded-md border">
				<div className="relative w-full overflow-x-auto">
					<Table>
						<TableHeader className="top-0 z-10 bg-background/95 backdrop-blur">
							<TableRow>
								<TableHead className="w-[180px] bg-background/95 backdrop-blur-sm border-b">
									<Button
										variant="ghost"
										onClick={() => handleSort("provider")}
										className="h-auto p-0 font-semibold hover:bg-transparent justify-start uppercase text-xs tracking-wider"
									>
										Provider
										{getSortIcon("provider")}
									</Button>
								</TableHead>
								<TableHead className="w-[280px] bg-background/95 backdrop-blur-sm border-b">
									<Button
										variant="ghost"
										onClick={() => handleSort("name")}
										className="h-auto p-0 font-semibold hover:bg-transparent justify-start uppercase text-xs tracking-wider"
									>
										Model ID
										{getSortIcon("name")}
									</Button>
								</TableHead>
								<TableHead className="text-right bg-background/95 backdrop-blur-sm border-b">
									<Button
										variant="ghost"
										onClick={() => handleSort("inputPrice")}
										className="h-auto p-0 font-semibold hover:bg-transparent uppercase text-xs tracking-wider"
									>
										Input $/M
										{getSortIcon("inputPrice")}
									</Button>
								</TableHead>
								<TableHead className="text-right bg-background/95 backdrop-blur-sm border-b">
									<Button
										variant="ghost"
										onClick={() => handleSort("outputPrice")}
										className="h-auto p-0 font-semibold hover:bg-transparent uppercase text-xs tracking-wider"
									>
										Output $/M
										{getSortIcon("outputPrice")}
									</Button>
								</TableHead>
								<TableHead className="text-right bg-background/95 backdrop-blur-sm border-b">
									<Button
										variant="ghost"
										onClick={() => handleSort("cachedInputPrice")}
										className="h-auto p-0 font-semibold hover:bg-transparent uppercase text-xs tracking-wider"
									>
										Cache Read $/M
										{getSortIcon("cachedInputPrice")}
									</Button>
								</TableHead>
								<TableHead className="text-center bg-background/95 backdrop-blur-sm border-b uppercase text-xs tracking-wider font-semibold">
									Features
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{paginatedFlattenedRows.map((row) => (
								<ModelTableRow
									key={row.rowKey}
									row={row}
									isExpanded={expandedRows.has(row.rowKey)}
									copiedModel={copiedModel}
									onToggleExpand={() => toggleRowExpanded(row.rowKey)}
									onCopy={copyToClipboard}
									onNavigate={() => {
										// Custom models have no public model page to navigate to.
										if (row.model.source === "custom") {
											return;
										}
										const url = modelHref(
											`/models/${encodeURIComponent(row.model.id)}/${row.provider.providerId}`,
										);
										if (modelHrefBase) {
											window.open(url, "_blank");
										} else {
											router.push(url);
										}
									}}
									formatPrice={formatPrice}
									modelHref={modelHref}
									pinnedCapabilityKeys={pinnedCapabilityKeys}
								/>
							))}
						</TableBody>
					</Table>
				</div>
			</div>
		);
	};

	const renderGridView = () => (
		<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
			{paginatedModels.map((model) => (
				<ModelCard
					key={`${model.id}-${model.providerDetails[0].provider.providerId}-${model.providerDetails[0].provider.region ?? ""}`}
					shouldShowStabilityWarning={shouldShowStabilityWarning}
					getCapabilityIcons={getCapabilityIcons}
					model={model}
					goToModel={() => {
						// Custom models have no public model page to navigate to.
						if (model.source === "custom") {
							return;
						}
						const url = modelHref(`/models/${encodeURIComponent(model.id)}`);
						if (modelHrefBase) {
							window.open(url, "_blank");
						} else {
							router.push(url);
						}
					}}
					formatPrice={formatPrice}
					renderCta={renderCta}
				/>
			))}
		</div>
	);

	return (
		<div className="min-h-screen text-foreground bg-background">
			{totalPages > 1 && (
				<>
					{safePage > 1 && (
						<link rel="prev" href={buildPageUrl(safePage - 1)} />
					)}
					{safePage < totalPages && (
						<link rel="next" href={buildPageUrl(safePage + 1)} />
					)}
				</>
			)}
			<main>
				{children}
				<div
					className={cn("container mx-auto px-4 pb-8 space-y-6", {
						"pt-40": children,
					})}
				>
					<TooltipProvider delayDuration={300} skipDelayDuration={100}>
						<div className="container mx-auto py-8 space-y-6">
							{!hideHeader && (
								<div className="flex items-start md:items-center justify-between flex-col md:flex-row gap-4">
									<div>
										<h1 className="text-3xl font-bold">{title ?? "Models"}</h1>
										<p className="text-muted-foreground mt-2">
											{description ??
												"Comprehensive list of all supported models and their providers"}
										</p>
									</div>

									<div className="flex items-center gap-2">
										<Link
											href="https://docs.llmgateway.io/v1_models"
											target="_blank"
											rel="noopener noreferrer"
										>
											<Button variant="outline" size="sm">
												<ExternalLink className="h-4 w-4 mr-1" />
												API Docs
											</Button>
										</Link>

										<Button size="sm" asChild>
											<Link href={modelHref("/models/compare")}>
												<Scale className="h-4 w-4 mr-1" />
												Compare
											</Link>
										</Button>
									</div>
								</div>
							)}

							<div className="flex flex-col gap-4">
								<div className="flex items-center gap-4">
									<div className="relative flex-1 max-w-sm">
										<Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
										<Input
											placeholder="Search models..."
											value={searchQuery}
											onChange={(e) => {
												const value = e.target.value;
												setSearchQuery(value);
												updateUrlWithFilters({ q: value ?? undefined });
											}}
											className="pl-8"
										/>
									</div>
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											const next = !showFilters;
											setShowFilters(next);
											updateUrlWithFilters({ filters: next ? "1" : undefined });
										}}
										className={
											hasActiveFilters ? "border-primary text-primary" : ""
										}
									>
										<Filter className="h-4 w-4 mr-1" />
										Filters
										{hasActiveFilters && (
											<Badge
												variant="secondary"
												className="ml-2 px-1 py-0 text-xs"
											>
												{[
													categoryFilter ? 1 : 0,
													searchQuery ? 1 : 0,
													filters.category &&
													filters.category !== defaultCategory
														? 1
														: 0,
													filters.tier && filters.tier !== "all" ? 1 : 0,
													filters.selectedProvider &&
													filters.selectedProvider !== "all"
														? 1
														: 0,
													Object.values(filters.capabilities).filter(Boolean)
														.length,
													filters.status ? 1 : 0,
													filters.source && filters.source !== "all" ? 1 : 0,
													filters.eligibleOnly ? 1 : 0,
													[
														filters.inputPrice.min,
														filters.inputPrice.max,
													].filter(Boolean).length,
													[
														filters.outputPrice.min,
														filters.outputPrice.max,
													].filter(Boolean).length,
													[
														filters.contextSize.min,
														filters.contextSize.max,
													].filter(Boolean).length,
												].reduce((a, b) => a + b, 0)}
											</Badge>
										)}
									</Button>
									{hasActiveFilters && (
										<Button variant="ghost" size="sm" onClick={clearFilters}>
											<X className="h-4 w-4 mr-1" />
											Clear
										</Button>
									)}
								</div>

								{renderFilters()}
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
								<Card>
									<CardContent>
										<div className="text-2xl font-bold">
											{hasActiveFilters
												? `${modelsWithProviders.length}/${totalModelCount}`
												: modelsWithProviders.length}
										</div>
										<div className="text-sm text-muted-foreground">Models</div>
									</CardContent>
								</Card>
								<Card>
									<CardContent>
										<div className="text-2xl font-bold">
											{hasActiveFilters
												? `${filteredProviderCount}/${totalProviderCount}`
												: totalProviderCount}
										</div>
										<div className="text-sm text-muted-foreground">
											Providers
										</div>
									</CardContent>
								</Card>
								<Card>
									<CardContent>
										<div className="text-2xl font-bold">
											{
												modelsWithProviders.filter((m) =>
													m.providerDetails.some((p) => p.provider.vision),
												).length
											}
										</div>
										<div className="text-sm text-muted-foreground">
											Vision Models{hasActiveFilters ? " (filtered)" : ""}
										</div>
									</CardContent>
								</Card>
								<Card>
									<CardContent>
										<div className="text-2xl font-bold">
											{
												modelsWithProviders.filter((m) =>
													m.providerDetails.some((p) => p.provider.tools),
												).length
											}
										</div>
										<div className="text-sm text-muted-foreground">
											Tool-enabled{hasActiveFilters ? " (filtered)" : ""}
										</div>
									</CardContent>
								</Card>
								<Card>
									<CardContent>
										<div className="text-2xl font-bold">
											{modelsWithProviders.filter((m) => m.free).length}
										</div>
										<div className="text-sm text-muted-foreground">
											Free Models{hasActiveFilters ? " (filtered)" : ""}
										</div>
									</CardContent>
								</Card>
							</div>
							<div className="flex items-center gap-2">
								<Button
									variant={viewMode === "table" ? "default" : "outline"}
									size="sm"
									onClick={() => {
										setViewMode("table");
										updateUrlWithFilters({ view: "table" });
									}}
								>
									<List className="h-4 w-4 mr-1" />
									Table
								</Button>
								<Button
									variant={viewMode === "grid" ? "default" : "outline"}
									size="sm"
									onClick={() => {
										setViewMode("grid");
										updateUrlWithFilters({ view: "grid" });
									}}
								>
									<Grid className="h-4 w-4 mr-1" />
									Grid
								</Button>
							</div>

							{viewMode === "table" ? renderTableView() : renderGridView()}

							{totalPages > 1 && (
								<nav
									aria-label="Pagination"
									className="flex items-center justify-center gap-2 pt-4"
								>
									<Button
										variant="outline"
										size="sm"
										disabled={safePage <= 1}
										onClick={() => goToPage(safePage - 1)}
									>
										<ChevronLeft className="h-4 w-4 mr-1" />
										Previous
									</Button>
									<span className="text-sm text-muted-foreground px-2">
										Page {safePage} of {totalPages}
									</span>
									<Button
										variant="outline"
										size="sm"
										disabled={safePage >= totalPages}
										onClick={() => goToPage(safePage + 1)}
									>
										Next
										<ChevronRight className="h-4 w-4 ml-1" />
									</Button>
								</nav>
							)}
						</div>
					</TooltipProvider>
				</div>
				{seoContent}
			</main>
			{footer}
		</div>
	);
}
