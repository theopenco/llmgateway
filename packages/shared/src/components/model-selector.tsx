"use client";

import {
	AlertTriangle,
	Braces,
	Check,
	ChevronsUpDown,
	Eye,
	ExternalLink,
	Filter,
	Gift,
	ImagePlus,
	Info,
	MessageSquare,
	Sparkles,
	Wrench,
	Zap,
} from "lucide-react";
import * as React from "react";

import {
	formatPrice,
	formatContextSize,
	getProviderForModel,
} from "@/lib/model-utils";
import { cn } from "@/lib/utils";

import {
	getProviderIcon,
	providerLogoUrls,
} from "@llmgateway/shared/components";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "./ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Separator } from "./ui/separator";

import type {
	ModelDefinition,
	ProviderDefinition,
	ProviderId,
	ProviderModelMapping,
} from "@llmgateway/models";
import type { LucideProps } from "lucide-react";

interface ModelSelectorProps {
	models: ModelDefinition[];
	providers: ProviderDefinition[];
	value?: string;
	onValueChange?: (value: string) => void;
	placeholder?: string;
}

interface FilterState {
	providers: string[];
	capabilities: string[];
	priceRange: "free" | "low" | "medium" | "high" | "all";
	hideUnstable: boolean;
	showOnlyRoot: boolean;
}

// helper to extract simple capability labels from a mapping
function getMappingCapabilities(
	mapping?: ProviderModelMapping,
	model?: ModelDefinition,
): string[] {
	const labels: string[] = [];

	if (mapping) {
		if (mapping.streaming) {
			labels.push("Streaming");
		}
		if (mapping.vision) {
			labels.push("Vision");
		}
		if (mapping.tools) {
			labels.push("Tools");
		}
		if (mapping.reasoning) {
			labels.push("Reasoning");
		}
	}

	// Image Generation capability if model outputs include images
	if (model?.output?.includes("image")) {
		labels.push("Image Generation");
	}
	return labels;
}

function getCapabilityIconConfig(capability: string): {
	Icon: React.ForwardRefExoticComponent<
		Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
	> | null;
	color: string;
} {
	switch (capability) {
		case "Streaming":
			return { Icon: Zap, color: "text-blue-500" };
		case "Vision":
			return { Icon: Eye, color: "text-green-500" };
		case "Tools":
			return { Icon: Wrench, color: "text-purple-500" };
		case "Reasoning":
			return { Icon: MessageSquare, color: "text-orange-500" };
		case "JSON Output":
			return { Icon: Braces, color: "text-cyan-500" };
		case "Image Generation":
			return { Icon: ImagePlus, color: "text-pink-500" };
		default:
			return { Icon: null, color: "" };
	}
}

// helper to check if a model is unstable or experimental
function isModelUnstable(
	mapping: ProviderModelMapping,
	model: ModelDefinition,
): boolean {
	const providerStability = mapping.stability;
	const modelStability = model.stability;
	const effectiveStability = providerStability ?? modelStability;
	return (
		effectiveStability === "unstable" || effectiveStability === "experimental"
	);
}

type PriceField = "input" | "output" | "cachedInput";

interface MappingPriceInfo {
	label: string;
	original?: string;
	discounted?: string;
}

// Helper to format prices using any provider discount while reusing shared formatPrice logic.
function getMappingPriceInfo(
	mapping: ProviderModelMapping | undefined,
	field: PriceField,
): MappingPriceInfo {
	if (!mapping) {
		return { label: "Unknown" };
	}

	let basePrice: number | undefined;
	if (field === "input") {
		basePrice = mapping.inputPrice;
	} else if (field === "output") {
		basePrice = mapping.outputPrice;
	} else {
		basePrice = mapping.cachedInputPrice;
	}

	if (basePrice === undefined) {
		return { label: "Unknown" };
	}

	// Free models
	if (basePrice === 0) {
		return { label: "Free", original: "Free" };
	}

	const original = formatPrice(basePrice);

	// Apply discount if present
	if (mapping.discount && mapping.discount > 0) {
		const discounted = formatPrice(basePrice * (1 - mapping.discount));
		return {
			label: discounted,
			original,
			discounted,
		};
	}

	return { label: original, original };
}

interface RootAggregateInfo {
	minInputPrice?: number;
	minOutputPrice?: number;
	minCachedInputPrice?: number;
	maxContextSize?: number;
	maxOutput?: number;
	capabilities: string[];
}

function getRootAggregateInfo(model: ModelDefinition): RootAggregateInfo {
	const now = new Date();

	let minInputPrice: number | undefined;
	let minOutputPrice: number | undefined;
	let minCachedInputPrice: number | undefined;
	let maxContextSize: number | undefined;
	let maxOutput: number | undefined;
	const capabilitySet = new Set<string>();

	const applyDiscount = (price: number | undefined, discount?: number) => {
		if (price === undefined) {
			return undefined;
		}
		if (price === 0) {
			return 0;
		}
		if (!discount || discount <= 0) {
			return price;
		}
		return price * (1 - discount);
	};

	for (const mapping of model.providers) {
		// Skip deactivated providers when computing "best" supported values
		const isDeactivated =
			mapping.deactivatedAt && new Date(mapping.deactivatedAt) <= now;
		if (isDeactivated) {
			continue;
		}

		const effectiveInput = applyDiscount(mapping.inputPrice, mapping.discount);
		if (
			effectiveInput !== undefined &&
			(minInputPrice === undefined || effectiveInput < minInputPrice)
		) {
			minInputPrice = effectiveInput;
		}

		const effectiveOutput = applyDiscount(
			mapping.outputPrice,
			mapping.discount,
		);
		if (
			effectiveOutput !== undefined &&
			(minOutputPrice === undefined || effectiveOutput < minOutputPrice)
		) {
			minOutputPrice = effectiveOutput;
		}

		const effectiveCached = applyDiscount(
			mapping.cachedInputPrice,
			mapping.discount,
		);
		if (
			effectiveCached !== undefined &&
			(minCachedInputPrice === undefined ||
				effectiveCached < minCachedInputPrice)
		) {
			minCachedInputPrice = effectiveCached;
		}

		if (
			mapping.contextSize !== undefined &&
			(maxContextSize === undefined || mapping.contextSize > maxContextSize)
		) {
			maxContextSize = mapping.contextSize;
		}

		if (
			mapping.maxOutput !== undefined &&
			(maxOutput === undefined || mapping.maxOutput > maxOutput)
		) {
			maxOutput = mapping.maxOutput;
		}

		getMappingCapabilities(mapping, model).forEach((capability) =>
			capabilitySet.add(capability),
		);
	}

	// Ensure image generation capability is included if any provider supports image output
	if (model.output?.includes("image")) {
		capabilitySet.add("Image Generation");
	}

	return {
		minInputPrice,
		minOutputPrice,
		minCachedInputPrice,
		maxContextSize,
		maxOutput,
		capabilities: Array.from(capabilitySet),
	};
}

// Removed old ModelItem; we render entries per provider below

export function ModelSelector({
	models,
	providers,
	value,
	onValueChange,
	placeholder = "Select model...",
}: ModelSelectorProps) {
	const [open, setOpen] = React.useState(false);
	const [filterOpen, setFilterOpen] = React.useState(false);
	const [searchQuery, setSearchQuery] = React.useState("");
	const [detailsOpen, setDetailsOpen] = React.useState(false);
	const [selectedDetails, setSelectedDetails] = React.useState<{
		model: ModelDefinition;
		mapping?: ProviderModelMapping;
		provider?: ProviderDefinition;
	} | null>(null);
	const [previewEntry, setPreviewEntry] = React.useState<{
		model: ModelDefinition;
		mapping?: ProviderModelMapping;
		provider?: ProviderDefinition;
		isRoot?: boolean;
	} | null>(null);
	const [filters, setFilters] = React.useState<FilterState>({
		providers: [],
		capabilities: [],
		priceRange: "all",
		hideUnstable: true,
		showOnlyRoot: false,
	});

	// Parse value as provider/model-id (preferred). Fallback to model id only.
	const raw = value ?? "";
	const [selectedProviderId, selectedModelId] = raw.includes("/")
		? (raw.split("/") as [string, string])
		: ["", raw];
	const selectedModel = models.find((m) => m.id === selectedModelId);
	const selectedProviderDef = providers.find(
		(p) => p.id === selectedProviderId,
	);

	// Simple normalizer for search matching
	const normalize = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, "");

	// Build entries of model per provider mapping (include all, filter later)
	const allEntries = React.useMemo(() => {
		const out: {
			model: ModelDefinition;
			mapping?: ProviderModelMapping;
			provider?: ProviderDefinition;
			isRoot?: boolean;
			searchText: string;
		}[] = [];
		const now = new Date();

		// Sort models by publishedAt date (when added to LLM Gateway), newest first
		// Falls back to releasedAt if publishedAt is not available
		const sortedModels = [...models].sort((a, b) => {
			const dateA = a.publishedAt
				? new Date(a.publishedAt).getTime()
				: a.releasedAt
					? new Date(a.releasedAt).getTime()
					: 0;
			const dateB = b.publishedAt
				? new Date(b.publishedAt).getTime()
				: b.releasedAt
					? new Date(b.releasedAt).getTime()
					: 0;
			return dateB - dateA;
		});

		for (const m of sortedModels) {
			if (m.id === "custom") {
				continue;
			}

			// Add root model entry (auto-routing)
			const rootSearchText = normalize(
				[m.name ?? "", m.family ?? "", m.id, "auto"].join(" "),
			);
			out.push({
				model: m,
				isRoot: true,
				searchText: rootSearchText,
			});

			// Skip provider entries for auto model - it should only appear as root
			if (m.id === "auto") {
				continue;
			}

			for (const mp of m.providers) {
				const isDeactivated =
					mp.deactivatedAt && new Date(mp.deactivatedAt) <= now;
				if (!isDeactivated) {
					const provider = providers.find((p) => p.id === mp.providerId);
					const searchText = normalize(
						[m.name ?? "", m.family ?? "", m.id, provider?.name ?? ""].join(
							" ",
						),
					);
					out.push({
						model: m,
						mapping: mp,
						provider,
						isRoot: false,
						searchText,
					});
				}
			}
		}
		return out;
	}, [models, providers]);

	// Defer search input value to keep typing responsive with large lists
	const deferredSearch = React.useDeferredValue(searchQuery);

	// Get unique providers and capabilities for filtering
	const availableProviders = React.useMemo(() => {
		const ids = new Set(
			allEntries.filter((e) => e.mapping).map((e) => e.mapping!.providerId),
		);
		return providers.filter((p) => ids.has(p.id as any));
	}, [allEntries, providers]);

	const availableCapabilities = React.useMemo(() => {
		const set = new Set<string>();
		allEntries.forEach((e) =>
			getMappingCapabilities(e.mapping, e.model).forEach((c) => set.add(c)),
		);
		return Array.from(set).sort();
	}, [allEntries]);

	const filteredEntries = React.useMemo(() => {
		let list = allEntries;

		if (filters.showOnlyRoot) {
			list = list.filter((e) => e.isRoot);
		}

		if (filters.hideUnstable) {
			list = list.filter((e) => {
				// Root models are considered stable unless model itself is unstable
				if (e.isRoot) {
					return (
						e.model.stability !== "unstable" &&
						e.model.stability !== "experimental"
					);
				}
				const providerStability = e.mapping?.stability;
				const modelStability = e.model.stability;
				const effectiveStability = providerStability ?? modelStability;
				return (
					effectiveStability !== "unstable" &&
					effectiveStability !== "experimental"
				);
			});
		}
		if (deferredSearch) {
			const q = normalize(deferredSearch);
			list = list.filter((entry) => entry.searchText.includes(q));
		}
		if (filters.providers.length > 0) {
			list = list.filter(
				(e) => e.mapping && filters.providers.includes(e.mapping.providerId),
			);
		}
		if (filters.capabilities.length > 0) {
			list = list.filter((e) => {
				const caps = getMappingCapabilities(e.mapping, e.model);
				return filters.capabilities.every((c) => caps.includes(c));
			});
		}
		if (filters.priceRange !== "all") {
			list = list.filter((e) => {
				// Root models don't have fixed price, exclude from price filter or include?
				// Let's exclude them if filtering by price, or maybe assume 'free' if unknown?
				// Safest is to only filter items that have a mapping.
				if (!e.mapping) {
					return false;
				}

				const price = e.mapping.inputPrice || 0;
				switch (filters.priceRange) {
					case "free":
						return price === 0;
					case "low":
						return price > 0 && price <= 0.000001;
					case "medium":
						return price > 0.000001 && price <= 0.00001;
					case "high":
						return price > 0.00001;
					default:
						return true;
				}
			});
		}
		return list;
	}, [allEntries, deferredSearch, filters]);

	const updateFilter = (key: keyof FilterState, value: any) => {
		setFilters((prev) => ({ ...prev, [key]: value }));
	};

	const toggleProviderFilter = (providerId: string) => {
		setFilters((prev) => ({
			...prev,
			providers: prev.providers.includes(providerId)
				? prev.providers.filter((id) => id !== providerId)
				: [...prev.providers, providerId],
			// If selecting providers, we probably don't want to show root models only
			showOnlyRoot: false,
		}));
	};

	const toggleCapabilityFilter = (capability: string) => {
		setFilters((prev) => ({
			...prev,
			capabilities: prev.capabilities.includes(capability)
				? prev.capabilities.filter((cap) => cap !== capability)
				: [...prev.capabilities, capability],
		}));
	};

	const clearFilters = () => {
		setFilters({
			providers: [],
			capabilities: [],
			priceRange: "all",
			hideUnstable: true,
			showOnlyRoot: false,
		});
	};

	const hasActiveFilters =
		filters.providers.length > 0 ||
		filters.capabilities.length > 0 ||
		filters.priceRange !== "all" ||
		!filters.hideUnstable ||
		filters.showOnlyRoot;

	const getProviderLogo = (providerId: ProviderId) => {
		const LogoComponent = providerLogoUrls[providerId];

		if (LogoComponent) {
			return <LogoComponent className="h-10 w-10 object-contain" />;
		}

		const IconComponent = getProviderIcon(providerId);
		return IconComponent ? (
			<IconComponent className="h-10 w-10" />
		) : (
			<div className="h-10 w-10 bg-gray-200 rounded" />
		);
	};

	// Keep desktop preview in sync with the currently selected model when opening
	React.useEffect(() => {
		if (!open) {
			return;
		}
		if (!selectedModel) {
			setPreviewEntry(null);
			return;
		}

		// Prefer provider-specific entry when a provider is selected
		let entry =
			selectedProviderId &&
			allEntries.find(
				(e) =>
					!e.isRoot &&
					e.model.id === selectedModel.id &&
					e.mapping?.providerId === selectedProviderId,
			);

		// Fallback to root entry for the selected model
		if (!entry) {
			entry = allEntries.find(
				(e) => e.isRoot && e.model.id === selectedModel.id,
			);
		}

		// Fallback to first filtered entry
		if (!entry && filteredEntries.length > 0) {
			entry = filteredEntries[0];
		}

		setPreviewEntry(
			entry
				? {
						model: entry.model,
						mapping: entry.mapping,
						provider: entry.provider,
						isRoot: entry.isRoot,
					}
				: null,
		);
	}, [open, selectedModel, selectedProviderId, allEntries, filteredEntries]);

	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						role="combobox"
						aria-expanded={open}
						className="w-full justify-between h-12 px-3 sm:px-4 bg-transparent"
					>
						{selectedModel ? (
							<div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
								{(() => {
									if (
										selectedModelId === selectedModel.id &&
										!selectedProviderDef
									) {
										return (
											<Sparkles className="h-5 w-5 shrink-0 text-primary" />
										);
									}
									return getProviderLogo(selectedModel.providers[0].providerId);
								})()}
								<div className="flex flex-col items-start min-w-0 flex-1">
									<div className="flex items-center gap-1 max-w-full">
										<span className="font-medium truncate">
											{selectedModel.name}
										</span>
										{(() => {
											const selectedMapping = selectedModel.providers.find(
												(p) => p.providerId === selectedProviderId,
											);
											const isUnstable =
												selectedMapping &&
												isModelUnstable(selectedMapping, selectedModel);
											const isDeprecated =
												selectedMapping?.deprecatedAt &&
												new Date(selectedMapping.deprecatedAt) <= new Date();
											return isUnstable || isDeprecated ? (
												<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-600 dark:text-yellow-500" />
											) : null;
										})()}
									</div>
									<span className="text-xs text-muted-foreground truncate max-w-full">
										{selectedModelId === selectedModel.id &&
										!selectedProviderDef
											? "Auto-select provider"
											: (
													selectedProviderDef ||
													getProviderForModel(selectedModel, providers)
												)?.name}
									</span>
								</div>
							</div>
						) : (
							<span className="truncate">{placeholder}</span>
						)}
						<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					className="w-[300px] sm:w-[720px] p-0"
					style={{ zIndex: 99999 }}
					sideOffset={4}
					align="start"
				>
					<div className="flex w-[300px] md:w-full">
						{/* Main content - model list & filters */}
						<div className="flex-1 w-[300px] md:w-[340px]">
							<Command shouldFilter={false}>
								<div className="flex items-center border-b px-3 w-[300px] md:w-full">
									<CommandInput
										placeholder="Search models..."
										value={searchQuery}
										onValueChange={setSearchQuery}
										className="h-12 border-0"
									/>
									<Popover open={filterOpen} onOpenChange={setFilterOpen}>
										<PopoverTrigger asChild>
											<Button
												variant="ghost"
												size="sm"
												className={cn(
													"ml-2 h-8 w-8 p-0",
													hasActiveFilters && "text-primary",
												)}
											>
												<Filter className="h-4 w-4" />
											</Button>
										</PopoverTrigger>
										<PopoverContent
											className="w-[calc(100vw-2rem)] sm:w-80 h-[400px] overflow-y-scroll md:h-full"
											style={{ zIndex: 100000 }}
											side="bottom"
											align="end"
										>
											<div className="space-y-4">
												<div className="flex items-center justify-between">
													<h4 className="font-medium">Filters</h4>
													{hasActiveFilters && (
														<Button
															variant="ghost"
															size="sm"
															onClick={clearFilters}
														>
															Clear all
														</Button>
													)}
												</div>

												{/* Root model filter */}
												<div className="flex items-center space-x-2">
													<Checkbox
														id="show-root"
														checked={filters.showOnlyRoot}
														onCheckedChange={(
															checked: boolean | "indeterminate" | undefined,
														) => updateFilter("showOnlyRoot", checked)}
													/>
													<Label
														htmlFor="show-root"
														className="text-sm cursor-pointer font-medium"
													>
														Show only root models
													</Label>
												</div>

												<Separator />

												{/* Provider filter */}
												<div className="space-y-2">
													<Label className="text-sm font-medium">
														Providers
													</Label>
													<div className="space-y-2 max-h-32 overflow-y-auto">
														{availableProviders.map((provider) => {
															const ProviderIcon = getProviderIcon(provider.id);
															return (
																<div
																	key={provider.id}
																	className="flex items-center space-x-2"
																>
																	<Checkbox
																		id={`provider-${provider.id}`}
																		checked={filters.providers.includes(
																			provider.id,
																		)}
																		onCheckedChange={() =>
																			toggleProviderFilter(provider.id)
																		}
																	/>
																	<Label
																		htmlFor={`provider-${provider.id}`}
																		className="flex items-center gap-2 text-sm cursor-pointer"
																	>
																		{ProviderIcon && (
																			<ProviderIcon
																				className="h-3 w-3"
																				style={{ color: provider.color }}
																			/>
																		)}
																		{provider.name}
																	</Label>
																</div>
															);
														})}
													</div>
												</div>

												<Separator />

												{/* Capabilities filter */}
												<div className="space-y-2">
													<Label className="text-sm font-medium">
														Capabilities
													</Label>
													<div className="space-y-2 max-h-32 overflow-y-auto">
														{availableCapabilities.map((capability) => (
															<div
																key={capability}
																className="flex items-center space-x-2"
															>
																<Checkbox
																	id={`capability-${capability}`}
																	checked={filters.capabilities.includes(
																		capability,
																	)}
																	onCheckedChange={() =>
																		toggleCapabilityFilter(capability)
																	}
																/>
																<Label
																	htmlFor={`capability-${capability}`}
																	className="text-sm cursor-pointer"
																>
																	{capability}
																</Label>
															</div>
														))}
													</div>
												</div>

												<Separator />

												{/* Price range filter */}
												<div className="space-y-2">
													<Label className="text-sm font-medium">
														Price Range
													</Label>
													<div className="space-y-2">
														{[
															{ value: "all", label: "All models" },
															{ value: "free", label: "Free models" },
															{ value: "low", label: "Low cost (≤ $0.000001)" },
															{
																value: "medium",
																label: "Medium cost (≤ $0.00001)",
															},
															{
																value: "high",
																label: "High cost (> $0.00001)",
															},
														].map((option) => (
															<div
																key={option.value}
																className="flex items-center space-x-2"
															>
																<Checkbox
																	id={`price-${option.value}`}
																	checked={filters.priceRange === option.value}
																	onCheckedChange={() =>
																		updateFilter("priceRange", option.value)
																	}
																/>
																<Label
																	htmlFor={`price-${option.value}`}
																	className="text-sm cursor-pointer"
																>
																	{option.label}
																</Label>
															</div>
														))}
													</div>
												</div>

												<Separator />

												{/* Stability filter */}
												<div className="space-y-2">
													<Label className="text-sm font-medium">
														Stability
													</Label>
													<div className="flex items-center space-x-2">
														<Checkbox
															id="hide-unstable"
															checked={filters.hideUnstable}
															onCheckedChange={(
																checked: boolean | "indeterminate" | undefined,
															) => updateFilter("hideUnstable", checked)}
														/>
														<Label
															htmlFor="hide-unstable"
															className="text-sm cursor-pointer"
														>
															Hide unstable/experimental models
														</Label>
													</div>
												</div>
											</div>
										</PopoverContent>
									</Popover>
								</div>
								<CommandList className="max-h-[300px] sm:max-h-[400px]">
									<CommandEmpty>
										No models found.
										{hasActiveFilters && (
											<Button
												variant="link"
												size="sm"
												onClick={clearFilters}
												className="mt-2"
											>
												Clear filters to see all models
											</Button>
										)}
									</CommandEmpty>
									<CommandGroup>
										<div className="px-2 py-1 text-xs text-muted-foreground">
											{filteredEntries.length} model
											{filteredEntries.length !== 1 ? "s" : ""} found
										</div>
										{filteredEntries.map(
											({ model, mapping, provider, isRoot }, index) => {
												if (isRoot) {
													const entryKey = `${model.id}-root-${index}`;
													const aggregate = getRootAggregateInfo(model);
													const isFreeRoot = aggregate.minInputPrice === 0;
													const isSelected =
														selectedModel?.id === model.id &&
														!selectedProviderId;
													return (
														<CommandItem
															key={entryKey}
															value={entryKey}
															onMouseEnter={() =>
																setPreviewEntry({
																	model,
																	mapping,
																	provider,
																	isRoot,
																})
															}
															onSelect={() => {
																onValueChange?.(model.id);
																setOpen(false);
															}}
															className="p-2 sm:p-3 cursor-pointer"
														>
															<Check
																className={cn(
																	"h-4 w-4",
																	isSelected ? "opacity-100" : "opacity-0",
																)}
															/>
															<div className="flex items-center justify-between w-[250px] md:w-full gap-2">
																<div className="flex items-center gap-2 min-w-0 flex-1">
																	<Sparkles className="h-6 w-6 shrink-0 text-primary" />
																	<div className="flex flex-col min-w-0 flex-1">
																		<div className="flex items-center gap-1">
																			<span className="font-medium truncate">
																				{model.name}
																			</span>
																			{isFreeRoot && (
																				<Gift className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
																			)}
																		</div>
																		<span className="text-xs text-muted-foreground truncate">
																			Auto-select provider
																		</span>
																	</div>
																</div>
																<Button
																	variant="ghost"
																	size="sm"
																	className="h-8 w-8 p-0 hover:bg-muted/50 shrink-0 md:hidden"
																	onClick={(
																		e: React.MouseEvent<HTMLButtonElement>,
																	) => {
																		e.stopPropagation();
																		setSelectedDetails({
																			model,
																		});
																		setDetailsOpen(true);
																	}}
																>
																	<Info className="h-4 w-4" />
																</Button>
															</div>
														</CommandItem>
													);
												}

												const ProviderIcon = provider
													? getProviderIcon(provider.id)
													: null;
												const entryKey = `${mapping!.providerId}-${model.id}-${index}`;
												const isUnstable = isModelUnstable(mapping!, model);
												const isDeprecated =
													mapping!.deprecatedAt &&
													new Date(mapping!.deprecatedAt) <= new Date();
												const isFreeMapping = mapping!.inputPrice === 0;
												const isSelected =
													selectedModel?.id === model.id &&
													selectedProviderId === mapping!.providerId;
												return (
													<CommandItem
														key={entryKey}
														value={entryKey}
														onMouseEnter={() =>
															setPreviewEntry({
																model,
																mapping,
																provider,
																isRoot,
															})
														}
														onSelect={() => {
															onValueChange?.(
																`${mapping!.providerId}/${model.id}`,
															);
															setOpen(false);
														}}
														className="p-2 sm:p-3 cursor-pointer"
													>
														<Check
															className={cn(
																"h-4 w-4",
																isSelected ? "opacity-100" : "opacity-0",
															)}
														/>
														<div className="flex items-center justify-between w-[250px] md:w-full gap-2">
															<div className="flex items-center gap-2 min-w-0 flex-1">
																{ProviderIcon ? (
																	<ProviderIcon className="h-6 w-6 shrink-0" />
																) : null}
																<div className="flex flex-col min-w-0 flex-1">
																	<div className="flex items-center gap-1">
																		<span className="font-medium truncate">
																			{model.name}
																		</span>
																		{isFreeMapping && (
																			<Gift className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
																		)}
																		{(isUnstable || isDeprecated) && (
																			<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-600 dark:text-yellow-500" />
																		)}
																	</div>
																	<span className="text-xs text-muted-foreground truncate">
																		{provider?.name}
																	</span>
																</div>
															</div>
															<Button
																variant="ghost"
																size="sm"
																className="h-8 w-8 p-0 hover:bg-muted/50 shrink-0 md:hidden"
																onClick={(
																	e: React.MouseEvent<HTMLButtonElement>,
																) => {
																	e.stopPropagation();
																	setSelectedDetails({
																		model,
																		mapping,
																		provider,
																	});
																	setDetailsOpen(true);
																}}
															>
																<Info className="h-4 w-4" />
															</Button>
														</div>
													</CommandItem>
												);
											},
										)}
									</CommandGroup>
								</CommandList>
							</Command>
						</div>
						{/* Desktop preview panel */}
						<div className="hidden md:block w-[360px] border-l border-border bg-muted/40">
							<div className="p-4 space-y-3 h-full overflow-y-auto">
								{previewEntry ? (
									<>
										<div className="flex items-center gap-3">
											{(() => {
												if (!previewEntry.provider) {
													return (
														<div className="p-2 rounded-lg bg-primary/10">
															<Sparkles className="h-5 w-5 text-primary" />
														</div>
													);
												}
												const ProviderIcon = getProviderIcon(
													previewEntry.provider.id,
												);
												return ProviderIcon ? (
													<div
														className="p-2 rounded-lg"
														style={{
															backgroundColor: `${previewEntry.provider?.color}15`,
														}}
													>
														<ProviderIcon className="h-5 w-5" />
													</div>
												) : null;
											})()}
											<div className="flex-1 min-w-0">
												<div className="font-semibold text-sm truncate">
													{previewEntry.model.name}
												</div>
												<div className="text-xs text-muted-foreground truncate">
													{previewEntry.provider?.name ??
														"Auto-select provider"}
												</div>
												<div className="text-[11px] text-muted-foreground capitalize truncate">
													{previewEntry.model.family} family
												</div>
											</div>
										</div>

										{!previewEntry.provider ? (
											<>
												<p className="text-xs text-muted-foreground leading-relaxed">
													This is a root model ID. The Gateway will
													automatically select the best provider for this model
													based on availability, performance, and cost. Specific
													capabilities and pricing will depend on the selected
													provider.
												</p>

												{(() => {
													const aggregate = getRootAggregateInfo(
														previewEntry.model,
													);

													const hasPricingOrLimits =
														aggregate.minInputPrice !== undefined ||
														aggregate.minOutputPrice !== undefined ||
														aggregate.maxContextSize !== undefined ||
														aggregate.maxOutput !== undefined;

													const hasCapabilities =
														aggregate.capabilities.length > 0;

													if (!hasPricingOrLimits && !hasCapabilities) {
														return null;
													}

													return (
														<div className="space-y-3 pt-3 border-t border-dashed">
															{hasPricingOrLimits && (
																<div className="space-y-2">
																	<h5 className="font-medium text-xs">
																		Pricing &amp; Limits{" "}
																		<span className="text-[11px] font-normal text-muted-foreground">
																			(starts at)
																		</span>
																	</h5>
																	<div className="grid grid-cols-2 gap-3">
																		<div className="space-y-1">
																			<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
																				Input
																			</span>
																			<p className="text-xs font-mono">
																				{aggregate.minInputPrice !== undefined
																					? formatPrice(aggregate.minInputPrice)
																					: "Unknown"}
																			</p>
																		</div>
																		<div className="space-y-1">
																			<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
																				Output
																			</span>
																			<p className="text-xs font-mono">
																				{aggregate.minOutputPrice !== undefined
																					? formatPrice(
																							aggregate.minOutputPrice,
																						)
																					: "Unknown"}
																			</p>
																		</div>
																		<div className="space-y-1">
																			<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
																				Context
																			</span>
																			<p className="text-xs font-mono">
																				{formatContextSize(
																					aggregate.maxContextSize,
																				)}
																			</p>
																		</div>
																		<div className="space-y-1">
																			<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
																				Max Output
																			</span>
																			<p className="text-xs font-mono">
																				{formatContextSize(aggregate.maxOutput)}
																			</p>
																		</div>
																	</div>
																</div>
															)}

															{hasCapabilities && (
																<div className="space-y-1">
																	<h5 className="font-medium text-xs">
																		Capabilities
																	</h5>
																	<div className="flex flex-wrap gap-1">
																		{aggregate.capabilities.map(
																			(capability) => {
																				const { Icon } =
																					getCapabilityIconConfig(capability);
																				return (
																					<Badge
																						key={capability}
																						variant="secondary"
																						className="text-[10px] px-1.5 py-0.5 flex items-center gap-1"
																					>
																						{Icon && <Icon size={12} />}
																						{capability}
																					</Badge>
																				);
																			},
																		)}
																	</div>
																</div>
															)}
														</div>
													);
												})()}
											</>
										) : (
											<>
												{previewEntry.provider?.description && (
													<p className="text-xs text-muted-foreground leading-relaxed">
														{previewEntry.provider.description}
													</p>
												)}

												<div className="space-y-2">
													<h5 className="font-medium text-xs">
														Pricing & Limits
													</h5>
													<div className="grid grid-cols-2 gap-3">
														<div className="space-y-1">
															<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
																Input
															</span>
															<p className="text-xs font-mono">
																{(() => {
																	const price = getMappingPriceInfo(
																		previewEntry.mapping,
																		"input",
																	);
																	if (
																		price.original &&
																		price.discounted &&
																		price.original !== price.discounted
																	) {
																		return (
																			<>
																				<span className="line-through text-muted-foreground">
																					{price.original}
																				</span>{" "}
																				<span className="text-green-500">
																					{price.discounted}
																				</span>
																			</>
																		);
																	}
																	return price.label;
																})()}
															</p>
														</div>
														<div className="space-y-1">
															<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
																Output
															</span>
															<p className="text-xs font-mono">
																{(() => {
																	const price = getMappingPriceInfo(
																		previewEntry.mapping,
																		"output",
																	);
																	if (
																		price.original &&
																		price.discounted &&
																		price.original !== price.discounted
																	) {
																		return (
																			<>
																				<span className="line-through text-muted-foreground">
																					{price.original}
																				</span>{" "}
																				<span className="text-green-500">
																					{price.discounted}
																				</span>
																			</>
																		);
																	}
																	return price.label;
																})()}
															</p>
														</div>
														<div className="space-y-1">
															<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
																Context
															</span>
															<p className="text-xs font-mono">
																{formatContextSize(
																	previewEntry.mapping?.contextSize,
																)}
															</p>
														</div>
														<div className="space-y-1">
															<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
																Max Output
															</span>
															<p className="text-xs font-mono">
																{formatContextSize(
																	previewEntry.mapping?.maxOutput,
																)}
															</p>
														</div>
													</div>
													{previewEntry.mapping?.cachedInputPrice && (
														<div className="pt-2 border-t border-dashed">
															<div className="space-y-1">
																<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
																	Cached Input
																</span>
																<p className="text-xs font-mono text-green-600 dark:text-green-400">
																	{(() => {
																		const price = getMappingPriceInfo(
																			previewEntry.mapping,
																			"cachedInput",
																		);
																		if (
																			price.original &&
																			price.discounted &&
																			price.original !== price.discounted
																		) {
																			return (
																				<>
																					<span className="line-through text-muted-foreground">
																						{price.original}
																					</span>{" "}
																					<span className="text-green-500">
																						{price.discounted}
																					</span>
																				</>
																			);
																		}
																		return price.label;
																	})()}
																</p>
															</div>
														</div>
													)}
												</div>

												{(() => {
													const caps = getMappingCapabilities(
														previewEntry.mapping,
														previewEntry.model,
													);
													return caps.length > 0 ? (
														<div className="space-y-1">
															<h5 className="font-medium text-xs">
																Capabilities
															</h5>
															<div className="flex flex-wrap gap-1">
																{caps.map((capability) => {
																	const { Icon } =
																		getCapabilityIconConfig(capability);
																	return (
																		<Badge
																			key={capability}
																			variant="secondary"
																			className="text-[10px] px-1.5 py-0.5 flex items-center gap-1"
																		>
																			{Icon && <Icon size={12} />}
																			{capability}
																		</Badge>
																	);
																})}
															</div>
														</div>
													) : null;
												})()}
											</>
										)}
									</>
								) : (
									<p className="text-xs text-muted-foreground">
										Hover a model to see details.
									</p>
								)}
							</div>
						</div>
					</div>
				</PopoverContent>
			</Popover>

			{/* Model Details Dialog */}
			<Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
				<DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
					{selectedDetails && (
						<>
							<DialogHeader>
								<DialogTitle className="flex items-center gap-3">
									{(() => {
										if (!selectedDetails.provider) {
											return (
												<div className="p-2 rounded-lg bg-primary/10">
													<Sparkles className="h-6 w-6 text-primary" />
												</div>
											);
										}
										const ProviderIcon = getProviderIcon(
											selectedDetails.provider.id,
										);
										return ProviderIcon ? (
											<div
												className="p-2 rounded-lg"
												style={{
													backgroundColor: `${selectedDetails.provider?.color}15`,
												}}
											>
												<ProviderIcon className="h-6 w-6" />
											</div>
										) : null;
									})()}
									<div className="flex-1">
										<div className="font-semibold text-base">
											{selectedDetails.model.name}
										</div>
										<div className="text-sm text-muted-foreground font-normal">
											{selectedDetails.provider?.name ?? "Auto-select provider"}
										</div>
										<div className="text-xs text-muted-foreground font-normal capitalize">
											{selectedDetails.model.family} family
										</div>
									</div>
									{selectedDetails.provider?.website && (
										<Button variant="ghost" size="sm" asChild>
											<a
												href={selectedDetails.provider.website}
												target="_blank"
												rel="noopener noreferrer"
												className="h-8 w-8 p-0"
											>
												<ExternalLink className="h-3 w-3" />
											</a>
										</Button>
									)}
								</DialogTitle>
							</DialogHeader>

							<div className="space-y-4">
								{!selectedDetails.provider ? (
									<div className="space-y-4">
										<p className="text-sm text-muted-foreground leading-relaxed">
											This is a root model ID. The Gateway will automatically
											select the best provider for this model based on
											availability, performance, and cost. Specific capabilities
											and pricing will depend on the selected provider.
										</p>

										{(() => {
											const aggregate = getRootAggregateInfo(
												selectedDetails.model,
											);

											const hasPricingOrLimits =
												aggregate.minInputPrice !== undefined ||
												aggregate.minOutputPrice !== undefined ||
												aggregate.maxContextSize !== undefined ||
												aggregate.maxOutput !== undefined;

											const hasCapabilities = aggregate.capabilities.length > 0;

											if (!hasPricingOrLimits && !hasCapabilities) {
												return null;
											}

											return (
												<div className="space-y-4">
													{hasPricingOrLimits && (
														<div className="space-y-3">
															<h5 className="font-medium text-sm">
																Pricing &amp; Limits{" "}
																<span className="text-xs font-normal text-muted-foreground">
																	(starts at)
																</span>
															</h5>
															<div className="grid grid-cols-2 gap-3">
																<div className="space-y-1">
																	<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
																		Input
																	</span>
																	<p className="text-sm font-mono">
																		{aggregate.minInputPrice !== undefined
																			? formatPrice(aggregate.minInputPrice)
																			: "Unknown"}
																	</p>
																</div>
																<div className="space-y-1">
																	<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
																		Output
																	</span>
																	<p className="text-sm font-mono">
																		{aggregate.minOutputPrice !== undefined
																			? formatPrice(aggregate.minOutputPrice)
																			: "Unknown"}
																	</p>
																</div>
																<div className="space-y-1">
																	<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
																		Context
																	</span>
																	<p className="text-sm font-mono">
																		{formatContextSize(
																			aggregate.maxContextSize,
																		)}
																	</p>
																</div>
																<div className="space-y-1">
																	<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
																		Max Output
																	</span>
																	<p className="text-sm font-mono">
																		{formatContextSize(aggregate.maxOutput)}
																	</p>
																</div>
															</div>
														</div>
													)}

													{hasCapabilities && (
														<div className="space-y-2">
															<h5 className="font-medium text-sm">
																Capabilities
															</h5>
															<div className="flex flex-wrap gap-1.5">
																{aggregate.capabilities.map((capability) => (
																	<Badge
																		key={capability}
																		variant="secondary"
																		className="text-xs px-2 py-1"
																	>
																		{capability}
																	</Badge>
																))}
															</div>
														</div>
													)}
												</div>
											);
										})()}
									</div>
								) : (
									<>
										{selectedDetails.provider?.description && (
											<>
												<p className="text-sm text-muted-foreground leading-relaxed">
													{selectedDetails.provider.description}
												</p>
												<Separator />
											</>
										)}

										<div className="space-y-3">
											<h5 className="font-medium text-sm">Pricing & Limits</h5>
											<div className="grid grid-cols-2 gap-3">
												<div className="space-y-1">
													<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
														Input
													</span>
													<p className="text-sm font-mono">
														{(() => {
															const price = getMappingPriceInfo(
																selectedDetails.mapping,
																"input",
															);
															if (
																price.original &&
																price.discounted &&
																price.original !== price.discounted
															) {
																return (
																	<>
																		<span className="line-through text-muted-foreground">
																			{price.original}
																		</span>{" "}
																		<span className="text-green-500">
																			{price.discounted}
																		</span>
																	</>
																);
															}
															return price.label;
														})()}
													</p>
												</div>
												<div className="space-y-1">
													<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
														Output
													</span>
													<p className="text-sm font-mono">
														{(() => {
															const price = getMappingPriceInfo(
																selectedDetails.mapping,
																"output",
															);
															if (
																price.original &&
																price.discounted &&
																price.original !== price.discounted
															) {
																return (
																	<>
																		<span className="line-through text-muted-foreground">
																			{price.original}
																		</span>{" "}
																		<span className="text-green-500">
																			{price.discounted}
																		</span>
																	</>
																);
															}
															return price.label;
														})()}
													</p>
												</div>
												<div className="space-y-1">
													<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
														Context
													</span>
													<p className="text-sm font-mono">
														{formatContextSize(
															selectedDetails.mapping?.contextSize,
														)}
													</p>
												</div>
												<div className="space-y-1">
													<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
														Max Output
													</span>
													<p className="text-sm font-mono">
														{formatContextSize(
															selectedDetails.mapping?.maxOutput,
														)}
													</p>
												</div>
											</div>
											{selectedDetails.mapping?.cachedInputPrice && (
												<div className="pt-2 border-t border-dashed">
													<div className="space-y-1">
														<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
															Cached Input
														</span>
														<p className="text-sm font-mono text-green-600 dark:text-green-400">
															{(() => {
																const price = getMappingPriceInfo(
																	selectedDetails.mapping,
																	"cachedInput",
																);
																if (
																	price.original &&
																	price.discounted &&
																	price.original !== price.discounted
																) {
																	return (
																		<>
																			<span className="line-through text-muted-foreground">
																				{price.original}
																			</span>{" "}
																			<span className="text-green-500">
																				{price.discounted}
																			</span>
																		</>
																	);
																}
																return price.label;
															})()}
														</p>
													</div>
												</div>
											)}
										</div>

										<Separator />

										{(() => {
											const caps = getMappingCapabilities(
												selectedDetails.mapping,
												selectedDetails.model,
											);
											return caps.length > 0 ? (
												<div className="space-y-2">
													<h5 className="font-medium text-sm">Capabilities</h5>
													<div className="flex flex-wrap gap-1.5">
														{caps.map((capability) => {
															const { Icon } =
																getCapabilityIconConfig(capability);
															return (
																<Badge
																	key={capability}
																	variant="secondary"
																	className="text-xs px-2 py-1 flex items-center gap-1.5"
																>
																	{Icon && <Icon size={14} />}
																	{capability}
																</Badge>
															);
														})}
													</div>
												</div>
											) : null;
										})()}
									</>
								)}
							</div>
						</>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
