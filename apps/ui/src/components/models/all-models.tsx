"use client";

import {
	Check,
	Copy,
	Eye,
	Gift,
	MessageSquare,
	Wrench,
	Zap,
	Grid,
	List,
	Search,
	Filter,
	X,
	ArrowUpDown,
	ArrowUp,
	ArrowDown,
	Play,
	ImagePlus,
	AlertTriangle,
	ExternalLink,
	Percent,
	Scale,
	Braces,
	FileJson2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useMemo, useState, useCallback, useEffect } from "react";

import Footer from "@/components/landing/footer";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";
import { Checkbox } from "@/lib/components/checkbox";
import { Input } from "@/lib/components/input";
import { getProviderIcon } from "@/lib/components/providers-icons";
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
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { useAppConfig } from "@/lib/config";
import { cn, formatContextSize } from "@/lib/utils";

import { models, providers } from "@llmgateway/models";

import { ModelCard } from "./model-card";

import type {
	ModelDefinition,
	ProviderModelMapping,
	StabilityLevel,
} from "@llmgateway/models";

interface ModelWithProviders extends ModelDefinition {
	providerDetails: Array<{
		provider: ProviderModelMapping;
		providerInfo: (typeof providers)[number];
	}>;
}

type SortField =
	| "name"
	| "providers"
	| "contextSize"
	| "inputPrice"
	| "outputPrice"
	| "cachedInputPrice";
type SortDirection = "asc" | "desc";

export function AllModels({ children }: { children: React.ReactNode }) {
	const config = useAppConfig();
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
		capabilities: {
			streaming: searchParams.get("streaming") === "true",
			vision: searchParams.get("vision") === "true",
			tools: searchParams.get("tools") === "true",
			reasoning: searchParams.get("reasoning") === "true",
			jsonOutput: searchParams.get("jsonOutput") === "true",
			jsonOutputSchema: searchParams.get("jsonOutputSchema") === "true",
			imageGeneration: searchParams.get("imageGeneration") === "true",
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
		const baseModels = (models as readonly ModelDefinition[]).map((model) => ({
			...model,
			providerDetails: model.providers.map((provider) => ({
				provider,
				providerInfo: providers.find((p) => p.id === provider.providerId)!,
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
					.map((t) => t.replace(/[^a-z0-9]/g, ""))
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

				const containsAllTokens = queryTokens.every((t) =>
					haystack.includes(t),
				);
				const containsPhrase = normalizedQuery
					? haystack.includes(normalizedQuery)
					: true;

				if (!(containsAllTokens || containsPhrase)) {
					return false;
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
			if (filters.capabilities.free && !model.free) {
				return false;
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
					if (p.provider.inputPrice === undefined) {
						return !min && !max;
					}
					const price = p.provider.inputPrice * 1e6; // Convert to per million tokens
					const minPrice = min ? parseFloat(min) : 0;
					const maxPrice = max ? parseFloat(max) : Infinity;
					return price >= minPrice && price <= maxPrice;
				});
			};

			const hasOutputPrice = (min: string, max: string) => {
				return model.providerDetails.some((p) => {
					if (p.provider.outputPrice === undefined) {
						return !min && !max;
					}
					const price = p.provider.outputPrice * 1e6; // Convert to per million tokens
					const minPrice = min ? parseFloat(min) : 0;
					const maxPrice = max ? parseFloat(max) : Infinity;
					return price >= minPrice && price <= maxPrice;
				});
			};

			const hasContextSize = (min: string, max: string) => {
				return model.providerDetails.some((p) => {
					if (p.provider.contextSize === undefined) {
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

		// Apply sorting
		if (!sortField) {
			return filteredModels;
		}

		return [...filteredModels].sort((a, b) => {
			let aValue: any;
			let bValue: any;

			switch (sortField) {
				case "name":
					aValue = (a.name || a.id).toLowerCase();
					bValue = (b.name || b.id).toLowerCase();
					break;
				case "providers":
					aValue = a.providerDetails.length;
					bValue = b.providerDetails.length;
					break;
				case "contextSize":
					// Get the max context size among all providers for this model
					aValue = Math.max(
						...a.providerDetails.map((p) => p.provider.contextSize || 0),
					);
					bValue = Math.max(
						...b.providerDetails.map((p) => p.provider.contextSize || 0),
					);
					break;
				case "inputPrice": {
					// Get the min input price among all providers for this model
					const aInputPrices = a.providerDetails
						.map((p) => p.provider.inputPrice)
						.filter((p) => p !== undefined);
					const bInputPrices = b.providerDetails
						.map((p) => p.provider.inputPrice)
						.filter((p) => p !== undefined);
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
						.filter((p) => p !== undefined);
					const bOutputPrices = b.providerDetails
						.map((p) => p.provider.outputPrice)
						.filter((p) => p !== undefined);
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
						.filter((p) => p !== undefined);
					const bCachedInputPrices = b.providerDetails
						.map((p) => p.provider.cachedInputPrice)
						.filter((p) => p !== undefined);
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
	}, [searchQuery, filters, sortField, sortDirection]);

	// Calculate unique filtered providers
	const filteredProviderCount = useMemo(() => {
		const uniqueProviders = new Set(
			modelsWithProviders.flatMap((model) =>
				model.providerDetails.map((p) => p.provider.providerId),
			),
		);
		return uniqueProviders.size;
	}, [modelsWithProviders]);

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

	const hasProviderStabilityWarning = (provider: ProviderModelMapping) => {
		const providerStability = provider.stability;
		return (
			providerStability &&
			["unstable", "experimental"].includes(providerStability)
		);
	};

	const copyToClipboard = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedModel(text);
			setTimeout(() => setCopiedModel(null), 2000);
		} catch (err) {
			console.error("Failed to copy text:", err);
		}
	};

	const formatPrice = (price: number | undefined, discount?: number) => {
		if (price === undefined) {
			return "—";
		}
		const originalPrice = (price * 1e6).toFixed(2);
		if (discount) {
			const discountedPrice = (price * 1e6 * (1 - discount)).toFixed(2);
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

	const getCapabilityIcons = (provider: ProviderModelMapping, model?: any) => {
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
		return capabilities;
	};

	const clearFilters = () => {
		setSearchQuery("");
		setFilters({
			capabilities: {
				streaming: false,
				vision: false,
				tools: false,
				reasoning: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				imageGeneration: false,
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
			streaming: undefined,
			vision: undefined,
			tools: undefined,
			reasoning: undefined,
			jsonOutput: undefined,
			jsonOutputSchema: undefined,
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
				<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
					<div className="space-y-3">
						<h3 className="font-medium text-sm">Capabilities</h3>
						<div className="space-y-2">
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
									label: "JSON Output",
									icon: Braces,
									color: "text-cyan-500",
								},
								{
									key: "jsonOutputSchema",
									label: "Structured JSON Output",
									icon: FileJson2,
									color: "text-teal-500",
								},
								{
									key: "imageGeneration",
									label: "Image Generation",
									icon: ImagePlus,
									color: "text-pink-500",
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
								<div key={key} className="flex items-center space-x-2">
									<Checkbox
										id={key}
										checked={
											filters.capabilities[
												key as keyof typeof filters.capabilities
											]
										}
										onCheckedChange={(checked) => {
											const isChecked = checked === true;
											setFilters((prev) => ({
												...prev,
												capabilities: {
													...prev.capabilities,
													[key]: isChecked,
												},
											}));
											updateUrlWithFilters({
												[key]: isChecked ? "true" : undefined,
											});
										}}
									/>
									<label
										htmlFor={key}
										className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
									>
										<Icon className={`h-4 w-4 ${color}`} />
										{label}
									</label>
								</div>
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
										<SelectItem key={provider.id} value={provider.id}>
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
			<div className="relative w-full overflow-x-auto sm:overflow-x-scroll">
				<Table className="min-w-[700px] sm:min-w-0">
					<TableHeader className="top-0 z-10 bg-background/95 backdrop-blur">
						<TableRow>
							<TableHead className="w-[250px] bg-background/95 backdrop-blur-sm border-b">
								<Button
									variant="ghost"
									onClick={() => handleSort("name")}
									className="h-auto p-0 font-semibold hover:bg-transparent justify-start"
								>
									Model
									{getSortIcon("name")}
								</Button>
							</TableHead>
							<TableHead className="bg-background/95 backdrop-blur-sm border-b">
								<Button
									variant="ghost"
									onClick={() => handleSort("providers")}
									className="h-auto p-0 font-semibold hover:bg-transparent justify-start"
								>
									Providers
									{getSortIcon("providers")}
								</Button>
							</TableHead>
							<TableHead className="text-center bg-background/95 backdrop-blur-sm border-b">
								<Button
									variant="ghost"
									onClick={() => handleSort("contextSize")}
									className="h-auto p-0 font-semibold hover:bg-transparent"
								>
									Context Size
									{getSortIcon("contextSize")}
								</Button>
							</TableHead>
							<TableHead className="text-center bg-background/95 backdrop-blur-sm border-b">
								<Button
									variant="ghost"
									onClick={() => handleSort("inputPrice")}
									className="h-auto p-0 font-semibold hover:bg-transparent"
								>
									Input Price
									{getSortIcon("inputPrice")}
								</Button>
							</TableHead>
							<TableHead className="text-center bg-background/95 backdrop-blur-sm border-b">
								<Button
									variant="ghost"
									onClick={() => handleSort("cachedInputPrice")}
									className="h-auto p-0 font-semibold hover:bg-transparent"
								>
									Cached Input Price
									{getSortIcon("cachedInputPrice")}
								</Button>
							</TableHead>
							<TableHead className="text-center bg-background/95 backdrop-blur-sm border-b">
								<Button
									variant="ghost"
									onClick={() => handleSort("outputPrice")}
									className="h-auto p-0 font-semibold hover:bg-transparent"
								>
									Output Price
									{getSortIcon("outputPrice")}
								</Button>
							</TableHead>
							<TableHead className="text-center bg-background/95 backdrop-blur-sm border-b">
								Capabilities
							</TableHead>
							<TableHead className="text-center">Stability</TableHead>
							<TableHead className="text-center bg-background/95 backdrop-blur-sm border-b">
								Actions
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{modelsWithProviders.map((model) => (
							<TableRow
								key={model.id}
								className="cursor-pointer hover:bg-muted/50 transition-colors"
								onClick={() =>
									router.push(`/models/${encodeURIComponent(model.id)}`)
								}
							>
								<TableCell className="font-medium">
									<div className="space-y-1">
										<div className="font-semibold text-sm flex items-center gap-2">
											<div className="truncate max-w-[150px]">
												{model.name || model.id}
											</div>
											{shouldShowStabilityWarning(model.stability) && (
												<AlertTriangle className="h-4 w-4 text-orange-500" />
											)}
											{model.free && (
												<Badge
													variant="secondary"
													className="text-xs bg-emerald-100 text-emerald-700 border-emerald-200"
												>
													<Gift className="h-3 w-3 mr-1" />
													Free
												</Badge>
											)}
										</div>
										<div className="text-xs text-muted-foreground">
											Family:{" "}
											<Badge variant="outline" className="text-xs">
												{model.family}
											</Badge>
										</div>
										<div className="flex items-center gap-1">
											<code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[150px]">
												{model.id}
											</code>
											<Button
												variant="ghost"
												size="sm"
												className="h-5 w-5 p-0"
												onClick={(e) => {
													e.stopPropagation();
													copyToClipboard(model.id);
												}}
												title="Copy model ID"
											>
												{copiedModel === model.id ? (
													<Check className="h-3 w-3 text-green-600" />
												) : (
													<Copy className="h-3 w-3" />
												)}
											</Button>
										</div>
									</div>
								</TableCell>

								<TableCell>
									<div className="flex flex-col flex-wrap gap-2">
										{model.providerDetails.map(({ provider, providerInfo }) => (
											<div
												key={provider.providerId}
												className="flex items-center gap-1"
											>
												<div className="w-5 h-5 flex items-center justify-center">
													{(() => {
														const ProviderIcon = getProviderIcon(
															provider.providerId,
														);
														return ProviderIcon ? (
															<ProviderIcon className="w-4 h-4" />
														) : (
															<div
																className="w-4 h-4 rounded-sm flex items-center justify-center text-xs font-medium text-white"
																style={{
																	backgroundColor:
																		providerInfo?.color || "#6b7280",
																}}
															>
																{(providerInfo?.name || provider.providerId)
																	.charAt(0)
																	.toUpperCase()}
															</div>
														);
													})()}
												</div>
												<Badge
													variant="secondary"
													className="text-xs"
													style={{ borderColor: providerInfo?.color }}
												>
													{providerInfo?.name || provider.providerId}
												</Badge>
												{hasProviderStabilityWarning(provider) && (
													<AlertTriangle className="h-3 w-3 text-orange-500" />
												)}
											</div>
										))}
									</div>
								</TableCell>

								<TableCell className="text-center">
									<div className="space-y-1">
										{model.providerDetails.map(({ provider }) => (
											<div key={provider.providerId} className="text-sm">
												{provider.contextSize
													? formatContextSize(provider.contextSize)
													: "—"}
											</div>
										))}
									</div>
								</TableCell>

								<TableCell className="text-center">
									<div className="space-y-1">
										{model.providerDetails.map(({ provider }) => (
											<div
												key={provider.providerId}
												className="text-sm font-mono"
											>
												{typeof formatPrice(
													provider.inputPrice,
													provider.discount,
												) === "string" ? (
													formatPrice(provider.inputPrice, provider.discount) +
													"/M"
												) : (
													<div className="flex gap-1 flex-row justify-center">
														{formatPrice(
															provider.inputPrice,
															provider.discount,
														)}
														<span className="text-muted-foreground">/M</span>
													</div>
												)}
											</div>
										))}
									</div>
								</TableCell>

								<TableCell className="text-center">
									<div className="space-y-1">
										{model.providerDetails.map(({ provider }) => (
											<div
												key={provider.providerId}
												className="text-sm font-mono"
											>
												{typeof formatPrice(
													provider.cachedInputPrice,
													provider.discount,
												) === "string" ? (
													formatPrice(
														provider.cachedInputPrice,
														provider.discount,
													) + "/M"
												) : (
													<div className="flex gap-1 flex-row justify-center">
														{formatPrice(
															provider.cachedInputPrice,
															provider.discount,
														)}
														<span className="text-muted-foreground">/M</span>
													</div>
												)}
											</div>
										))}
									</div>
								</TableCell>

								<TableCell className="text-center">
									<div className="space-y-1">
										{model.providerDetails.map(({ provider }) => (
											<div
												key={provider.providerId}
												className="text-sm font-mono"
											>
												{typeof formatPrice(
													provider.outputPrice,
													provider.discount,
												) === "string" ? (
													formatPrice(provider.outputPrice, provider.discount) +
													"/M"
												) : (
													<div className="flex gap-1 flex-row justify-center">
														{formatPrice(
															provider.outputPrice,
															provider.discount,
														)}
														<span className="text-muted-foreground">/M</span>
													</div>
												)}
											</div>
										))}
									</div>
								</TableCell>

								<TableCell className="text-center">
									<div className="space-y-2">
										{model.providerDetails.map(({ provider }) => (
											<div
												key={provider.providerId}
												className="flex justify-center gap-1"
											>
												{getCapabilityIcons(provider, model).map(
													({ icon: Icon, label, color }) => (
														<Tooltip key={label}>
															<TooltipTrigger asChild>
																<div
																	className="cursor-help focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm p-0.5 -m-0.5"
																	tabIndex={0}
																	role="button"
																	aria-label={`Model capability: ${label}`}
																>
																	<Icon className={`h-4 w-4 ${color}`} />
																</div>
															</TooltipTrigger>
															<TooltipContent
																className="bg-popover text-popover-foreground border border-border shadow-md"
																side="top"
																align="center"
																avoidCollisions={true}
															>
																<p>{label}</p>
															</TooltipContent>
														</Tooltip>
													),
												)}
											</div>
										))}
									</div>
								</TableCell>

								<TableCell className="text-center">
									{(() => {
										const stabilityProps = getStabilityBadgeProps(
											model.stability,
										);
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
								</TableCell>

								<TableCell className="text-center">
									<Button
										variant="outline"
										size="sm"
										className="h-8 gap-2"
										title={`Try ${model.name || model.id} in playground`}
										onClick={(e) => e.stopPropagation()}
										asChild
									>
										<a
											href={`${config.playgroundUrl}?model=${encodeURIComponent(`${model.providers[0]?.providerId}/${model.id}`)}`}
											target="_blank"
											rel="noopener noreferrer"
										>
											<Play className="h-3 w-3" />
											Try it
										</a>
									</Button>
								</TableCell>
							</TableRow>
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
					key={model.id}
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
									<CardContent className="p-4">
										<div className="text-2xl font-bold">
											{hasActiveFilters
												? `${modelsWithProviders.length}/${totalModelCount}`
												: modelsWithProviders.length}
										</div>
										<div className="text-sm text-muted-foreground">Models</div>
									</CardContent>
								</Card>
								<Card>
									<CardContent className="p-4">
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
									<CardContent className="p-4">
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
									<CardContent className="p-4">
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
									<CardContent className="p-4">
										<div className="text-2xl font-bold">
											{modelsWithProviders.filter((m) => m.free).length}
										</div>
										<div className="text-sm text-muted-foreground">
											Free Models{hasActiveFilters ? " (filtered)" : ""}
										</div>
									</CardContent>
								</Card>
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
