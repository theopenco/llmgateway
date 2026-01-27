"use client";

import {
	Check,
	ChevronDown,
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
	ImagePlus,
	ExternalLink,
	Percent,
	Scale,
	Braces,
	FileJson2,
	List,
	Grid,
	Bot,
	Brain,
	Sparkles,
	PenTool,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useMemo, useState, useCallback, useEffect } from "react";

import Footer from "@/components/landing/footer";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { Toggle } from "@/lib/components/toggle";
import { TooltipProvider } from "@/lib/components/tooltip";
import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared/components";

import { ModelCard } from "./model-card";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "@/lib/fetch-models";
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
}

type SortField =
	| "provider"
	| "name"
	| "inputPrice"
	| "outputPrice"
	| "cachedInputPrice";
type SortDirection = "asc" | "desc";

// Capability icon type
interface CapabilityIcon {
	icon: React.ComponentType<{ className?: string }>;
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

// Helper to compute capabilities (moved outside component for performance)
function computeCapabilities(
	provider: ApiModelProviderMapping,
	model: ApiModel,
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
	if (provider.webSearch) {
		capabilities.push({
			icon: Globe,
			label: "Web Search",
			color: "text-sky-500",
		});
	}
	return capabilities;
}

// Memoized table row component for performance
const ModelTableRow = React.memo(
	({
		row,
		isExpanded,
		copiedModel,
		onToggleExpand,
		onCopy,
		onNavigate,
	}: {
		row: FlattenedModelRow;
		isExpanded: boolean;
		copiedModel: string | null;
		onToggleExpand: () => void;
		onCopy: (text: string, e: React.MouseEvent) => void;
		onNavigate: () => void;
	}) => {
		const { ProviderIcon } = row;

		return (
			<>
				<TableRow
					className="cursor-pointer hover:bg-muted/50 transition-colors"
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
										backgroundColor: row.providerInfo?.color || "#6b7280",
									}}
								>
									{(row.providerInfo?.name || row.provider.providerId)
										.charAt(0)
										.toUpperCase()}
								</div>
							)}
							<span className="text-sm">
								{row.providerInfo?.name || row.provider.providerId}
							</span>
							<ExternalLink className="h-3 w-3 text-muted-foreground" />
						</div>
					</TableCell>

					{/* Model ID Column */}
					<TableCell>
						<div className="flex items-center gap-2">
							<span className="font-medium text-sm">{row.model.id}</span>
							<button
								onClick={(e) => onCopy(row.model.id, e)}
								className="p-1 hover:bg-muted rounded transition-colors"
								title={
									copiedModel === row.model.id ? "Copied!" : "Copy model ID"
								}
							>
								{copiedModel === row.model.id ? (
									<Check className="h-3 w-3 text-green-500" />
								) : (
									<Copy className="h-3 w-3 text-muted-foreground" />
								)}
							</button>
							<ExternalLink className="h-3 w-3 text-muted-foreground" />
						</div>
					</TableCell>

					{/* Input Price Column */}
					<TableCell className="text-right font-mono text-sm">
						{row.provider.inputPrice !== null &&
						row.provider.inputPrice !== undefined
							? `$${(parseFloat(row.provider.inputPrice) * 1e6).toFixed(2)}`
							: "—"}
					</TableCell>

					{/* Output Price Column */}
					<TableCell className="text-right font-mono text-sm">
						{row.provider.outputPrice !== null &&
						row.provider.outputPrice !== undefined
							? `$${(parseFloat(row.provider.outputPrice) * 1e6).toFixed(2)}`
							: "—"}
					</TableCell>

					{/* Cache Read Price Column */}
					<TableCell className="text-right font-mono text-sm">
						{row.provider.cachedInputPrice !== null &&
						row.provider.cachedInputPrice !== undefined
							? `$${(parseFloat(row.provider.cachedInputPrice) * 1e6).toFixed(2)}`
							: "—"}
					</TableCell>

					{/* Features Column */}
					<TableCell className="text-center">
						<div className="flex justify-center gap-1">
							{row.capabilities
								.slice(0, 4)
								.map(({ icon: Icon, label, color }) => (
									<div key={label} className="p-0.5" title={label}>
										<Icon className={`h-4 w-4 ${color}`} />
									</div>
								))}
						</div>
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
								</div>
							</div>
						</TableCell>
					</TableRow>
				)}
			</>
		);
	},
);

export function AllModels({ children, models, providers }: AllModelsProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const isMobile = useIsMobile();

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
	const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
	const [showFilters, setShowFilters] = useState(
		searchParams.get("filters") === "1",
	);

	// Sorting states
	const [sortField, setSortField] = useState<SortField | null>(
		(searchParams.get("sortField") as SortField) || null,
	);
	const [sortDirection, setSortDirection] = useState<SortDirection>(
		(searchParams.get("sortDir") as SortDirection) === "desc" ? "desc" : "asc",
	);
	const [filters, setFilters] = useState({
		category: searchParams.get("category") || "all",
		capabilities: {
			streaming: searchParams.get("streaming") === "true",
			vision: searchParams.get("vision") === "true",
			tools: searchParams.get("tools") === "true",
			reasoning: searchParams.get("reasoning") === "true",
			jsonOutput: searchParams.get("jsonOutput") === "true",
			jsonOutputSchema: searchParams.get("jsonOutputSchema") === "true",
			imageGeneration: searchParams.get("imageGeneration") === "true",
			webSearch: searchParams.get("webSearch") === "true",
			free: searchParams.get("free") === "true",
			discounted: searchParams.get("discounted") === "true",
		},
		selectedProvider: searchParams.get("provider") || "all",
		inputPrice: {
			min: searchParams.get("inputPriceMin") || "",
			max: searchParams.get("inputPriceMax") || "",
		},
		outputPrice: {
			min: searchParams.get("outputPriceMin") || "",
			max: searchParams.get("outputPriceMax") || "",
		},
		contextSize: {
			min: searchParams.get("contextSizeMin") || "",
			max: searchParams.get("contextSizeMax") || "",
		},
	});

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

	// Calculate total counts
	const totalModelCount = models.length;
	const totalProviderCount = providers.length;

	const modelsWithProviders: ModelWithProviders[] = useMemo(() => {
		const baseModels = models.map((model) => ({
			...model,
			providerDetails: model.mappings.map((mapping) => ({
				provider: mapping,
				providerInfo: providers.find((p) => p.id === mapping.providerId)!,
			})),
		}));

		const filteredModels = baseModels.filter((model) => {
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

				const providerStrings = (model.providerDetails || []).flatMap((p) => [
					p.provider.providerId,
					p.providerInfo?.name || "",
				]);
				const haystackParts = [
					model.name || "",
					model.id,
					model.family,
					...(model.aliases || []),
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

			// Category filter
			if (filters.category && filters.category !== "all") {
				switch (filters.category) {
					case "code": {
						// Code generation: needs tools, JSON output, streaming
						if (model.free) {
							return false;
						}
						if (
							model.stability === "unstable" ||
							model.stability === "experimental"
						) {
							return false;
						}
						const hasCodeCapabilities = model.providerDetails.some(
							(p) =>
								(p.provider.jsonOutput || p.provider.jsonOutputSchema) &&
								p.provider.tools &&
								p.provider.streaming,
						);
						if (!hasCodeCapabilities) {
							return false;
						}
						break;
					}
					case "chat": {
						// Chat & Assistants: general chat models with streaming
						const hasStreaming = model.providerDetails.some(
							(p) => p.provider.streaming,
						);
						if (!hasStreaming) {
							return false;
						}
						break;
					}
					case "reasoning": {
						// Reasoning & Analysis: models with reasoning capability
						const hasReasoning = model.providerDetails.some(
							(p) => p.provider.reasoning,
						);
						if (!hasReasoning) {
							return false;
						}
						break;
					}
					case "creative": {
						// Creative & Writing: exclude image generation models
						if (model.output?.includes("image")) {
							return false;
						}
						const hasCreativeStreaming = model.providerDetails.some(
							(p) => p.provider.streaming,
						);
						if (!hasCreativeStreaming) {
							return false;
						}
						break;
					}
					case "image": {
						// Image Generation
						if (!model.output?.includes("image")) {
							return false;
						}
						break;
					}
					case "multimodal": {
						// Multimodal: vision capability
						const hasVision = model.providerDetails.some(
							(p) => p.provider.vision,
						);
						if (!hasVision) {
							return false;
						}
						break;
					}
				}
			}

			// Capability filters
			if (
				filters.capabilities.streaming &&
				!model.providerDetails.some((p) => p.provider.streaming)
			) {
				return false;
			}
			if (
				filters.capabilities.vision &&
				!model.providerDetails.some((p) => p.provider.vision)
			) {
				return false;
			}
			if (
				filters.capabilities.tools &&
				!model.providerDetails.some((p) => p.provider.tools)
			) {
				return false;
			}
			if (
				filters.capabilities.reasoning &&
				!model.providerDetails.some((p) => p.provider.reasoning)
			) {
				return false;
			}
			if (
				filters.capabilities.jsonOutput &&
				!model.providerDetails.some((p) => p.provider.jsonOutput)
			) {
				return false;
			}
			if (
				filters.capabilities.jsonOutputSchema &&
				!model.providerDetails.some((p) => p.provider.jsonOutputSchema)
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
				filters.capabilities.webSearch &&
				!model.providerDetails.some((p) => p.provider.webSearch)
			) {
				return false;
			}
			if (filters.capabilities.free) {
				// A model is only considered free if it has the free flag AND no provider has a per-request cost
				const hasRequestPrice = model.providerDetails.some(
					(p) =>
						p.provider.requestPrice && parseFloat(p.provider.requestPrice) > 0,
				);
				if (!model.free || hasRequestPrice) {
					return false;
				}
			}
			if (
				filters.capabilities.discounted &&
				!model.providerDetails.some((p) => p.provider.discount)
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

		// Apply sorting - default to releasedAt descending (newest first)
		return [...filteredModels].sort((a, b) => {
			// Default sorting by releasedAt when no sort field selected
			if (!sortField) {
				const aDate = a.releasedAt ? new Date(a.releasedAt).getTime() : 0;
				const bDate = b.releasedAt ? new Date(b.releasedAt).getTime() : 0;
				return bDate - aDate; // Descending (newest first)
			}

			let aValue: any;
			let bValue: any;

			switch (sortField) {
				case "provider":
					// For grid view, sort by first provider name
					aValue = (
						a.providerDetails[0]?.providerInfo?.name ||
						a.providerDetails[0]?.provider.providerId ||
						""
					).toLowerCase();
					bValue = (
						b.providerDetails[0]?.providerInfo?.name ||
						b.providerDetails[0]?.provider.providerId ||
						""
					).toLowerCase();
					break;
				case "name":
					aValue = (a.name || a.id).toLowerCase();
					bValue = (b.name || b.id).toLowerCase();
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
	}, [searchQuery, filters, sortField, sortDirection, models, providers]);

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

		for (const model of modelsWithProviders) {
			for (const { provider, providerInfo } of model.providerDetails) {
				const hasAdditionalPricing =
					provider.webSearch ||
					(provider.requestPrice !== null &&
						provider.requestPrice !== undefined &&
						parseFloat(provider.requestPrice) > 0);

				rows.push({
					model,
					provider,
					providerInfo,
					hasAdditionalPricing,
					rowKey: `${provider.providerId}-${model.id}`,
					capabilities: computeCapabilities(provider, model),
					ProviderIcon: getProviderIcon(provider.providerId),
				});
			}
		}

		// Sort flattened rows
		return rows.sort((a, b) => {
			if (!sortField) {
				// Default: sort by releasedAt descending (newest first)
				const aDate = a.model.releasedAt
					? new Date(a.model.releasedAt).getTime()
					: 0;
				const bDate = b.model.releasedAt
					? new Date(b.model.releasedAt).getTime()
					: 0;
				return bDate - aDate;
			}

			let aValue: string | number;
			let bValue: string | number;

			switch (sortField) {
				case "provider":
					aValue = (
						a.providerInfo?.name || a.provider.providerId
					).toLowerCase();
					bValue = (
						b.providerInfo?.name || b.provider.providerId
					).toLowerCase();
					break;
				case "name":
					aValue = (a.model.name || a.model.id).toLowerCase();
					bValue = (b.model.name || b.model.id).toLowerCase();
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
	}, [modelsWithProviders, sortField, sortDirection]);

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
		async (text: string, e: React.MouseEvent) => {
			e.stopPropagation();
			try {
				await navigator.clipboard.writeText(text);
				setCopiedModel(text);
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
				<div className="flex flex-col justify-items-center">
					<div className="flex items-center gap-1">
						<span className="line-through text-muted-foreground text-xs">
							${originalPrice}
						</span>
						<span className="text-green-600 font-semibold">
							${discountedPrice}
						</span>
					</div>
				</div>
			);
		}
		return `$${originalPrice}`;
	};

	const getCapabilityIcons = (
		provider: ApiModelProviderMapping,
		model?: ApiModel,
	) => {
		const capabilities = [];
		if (provider.streaming) {
			capabilities.push({
				icon: Zap,
				label: "Streaming",
				color: "text-blue-500",
			});
		}
		if (provider.vision) {
			capabilities.push({
				icon: Eye,
				label: "Vision",
				color: "text-green-500",
			});
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
				label: "Structured JSON Output",
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
		if (provider.webSearch) {
			capabilities.push({
				icon: Globe,
				label: "Native Web Search",
				color: "text-sky-500",
			});
		}
		return capabilities;
	};

	const clearFilters = () => {
		setSearchQuery("");
		setFilters({
			category: "all",
			capabilities: {
				streaming: false,
				vision: false,
				tools: false,
				reasoning: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				imageGeneration: false,
				webSearch: false,
				free: false,
				discounted: false,
			},
			selectedProvider: "all",
			inputPrice: { min: "", max: "" },
			outputPrice: { min: "", max: "" },
			contextSize: { min: "", max: "" },
		});
		setSortField(null);
		setSortDirection("asc");

		updateUrlWithFilters({
			q: undefined,
			category: undefined,
			streaming: undefined,
			vision: undefined,
			tools: undefined,
			reasoning: undefined,
			jsonOutput: undefined,
			jsonOutputSchema: undefined,
			imageGeneration: undefined,
			webSearch: undefined,
			free: undefined,
			discounted: undefined,
			provider: undefined,
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

	const hasActiveFilters =
		searchQuery ||
		(filters.category && filters.category !== "all") ||
		Object.values(filters.capabilities).some(Boolean) ||
		(filters.selectedProvider && filters.selectedProvider !== "all") ||
		filters.inputPrice.min ||
		filters.inputPrice.max ||
		filters.outputPrice.min ||
		filters.outputPrice.max ||
		filters.contextSize.min ||
		filters.contextSize.max ||
		sortField !== null;

	const renderFilters = () => (
		<Card
			className={`transition-all duration-200 ${showFilters ? "opacity-100" : "opacity-0 hidden"}`}
		>
			<CardContent className="pt-6">
				<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
					{/* Categories */}
					<div className="space-y-3">
						<h3 className="font-medium text-sm">Use Case</h3>
						<Select
							value={filters.category}
							onValueChange={(value) => {
								setFilters((prev) => ({ ...prev, category: value }));
								updateUrlWithFilters({
									category: value !== "all" ? value : undefined,
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
					</div>

					{/* Capabilities */}
					<div className="space-y-3">
						<h3 className="font-medium text-sm">Capabilities</h3>
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
										updateUrlWithFilters({
											[key]: pressed ? "true" : undefined,
										});
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
						<h3 className="font-medium text-sm">Provider</h3>
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
					</div>

					<div className="space-y-3">
						<h3 className="font-medium text-sm">Input Price ($/M tokens)</h3>
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
									updateUrlWithFilters({ inputPriceMin: value || undefined });
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
									updateUrlWithFilters({ inputPriceMax: value || undefined });
								}}
								className="h-8"
							/>
						</div>
					</div>

					<div className="space-y-3">
						<h3 className="font-medium text-sm">Output Price ($/M tokens)</h3>
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
									updateUrlWithFilters({ outputPriceMin: value || undefined });
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
									updateUrlWithFilters({ outputPriceMax: value || undefined });
								}}
								className="h-8"
							/>
						</div>
					</div>

					<div className="space-y-3">
						<h3 className="font-medium text-sm">Context Size (tokens)</h3>
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
									updateUrlWithFilters({ contextSizeMin: value || undefined });
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
									updateUrlWithFilters({ contextSizeMax: value || undefined });
								}}
								className="h-8"
							/>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);

	const renderTableView = () => (
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
						{flattenedRows.map((row) => (
							<ModelTableRow
								key={row.rowKey}
								row={row}
								isExpanded={expandedRows.has(row.rowKey)}
								copiedModel={copiedModel}
								onToggleExpand={() => toggleRowExpanded(row.rowKey)}
								onCopy={copyToClipboard}
								onNavigate={() =>
									router.push(
										`/models/${encodeURIComponent(row.model.id)}/${row.provider.providerId}`,
									)
								}
							/>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);

	const renderGridView = () => (
		<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
			{modelsWithProviders.map((model) => (
				<ModelCard
					key={`${model.id}-${model.providerDetails[0].provider.providerId}`}
					shouldShowStabilityWarning={shouldShowStabilityWarning}
					getCapabilityIcons={getCapabilityIcons}
					model={model}
					goToModel={() =>
						router.push(`/models/${encodeURIComponent(model.id)}`)
					}
					formatPrice={formatPrice}
				/>
			))}
		</div>
	);

	return (
		<div className="min-h-screen text-foreground bg-background">
			<main>
				{children}
				<div
					className={cn("container mx-auto px-4 pb-8 space-y-6", {
						"pt-40": children,
					})}
				>
					<TooltipProvider delayDuration={300} skipDelayDuration={100}>
						<div className="container mx-auto py-8 space-y-6">
							<div className="flex items-start md:items-center justify-between flex-col md:flex-row gap-4">
								<div>
									<h1 className="text-3xl font-bold">Models</h1>
									<p className="text-muted-foreground mt-2">
										Comprehensive list of all supported models and their
										providers
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
										<Link href="/models/compare">
											<Scale className="h-4 w-4 mr-1" />
											Compare
										</Link>
									</Button>
								</div>
							</div>

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
												updateUrlWithFilters({ q: value || undefined });
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
													searchQuery ? 1 : 0,
													Object.values(filters.capabilities).filter(Boolean)
														.length,
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
						</div>
					</TooltipProvider>
				</div>
			</main>
			<Footer />
		</div>
	);
}
