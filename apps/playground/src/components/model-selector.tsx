"use client";

import {
	Check,
	ChevronsUpDown,
	Filter,
	Info,
	ExternalLink,
	AlertTriangle,
} from "lucide-react";
import * as React from "react";

import { getProviderIcon } from "@/components/provider-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
	formatPrice,
	formatContextSize,
	getProviderForModel,
} from "@/lib/model-utils";
import { cn } from "@/lib/utils";

import type {
	ModelDefinition,
	ProviderDefinition,
	ProviderModelMapping,
} from "@llmgateway/models";

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
}

// helper to extract simple capability labels from a mapping
function getMappingCapabilities(
	mapping?: ProviderModelMapping,
	model?: ModelDefinition,
): string[] {
	if (!mapping) {
		return [];
	}
	const labels: string[] = [];
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
	// Image Generation capability if model outputs include images
	if (model?.output?.includes("image")) {
		labels.push("Image Generation");
	}
	return labels;
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
		mapping: ProviderModelMapping;
		provider?: ProviderDefinition;
	} | null>(null);
	const [filters, setFilters] = React.useState<FilterState>({
		providers: [],
		capabilities: [],
		priceRange: "all",
		hideUnstable: true,
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
	const selectedEntryKey =
		selectedModel && selectedProviderId
			? `${selectedProviderId}-${selectedModel.id}`
			: "";

	// Build entries of model per provider mapping (include all, filter later)
	const allEntries = React.useMemo(() => {
		const out: {
			model: ModelDefinition;
			mapping: ProviderModelMapping;
			provider?: ProviderDefinition;
		}[] = [];
		for (const m of models) {
			if (m.id === "custom") {
				continue;
			}
			for (const mp of m.providers) {
				out.push({
					model: m,
					mapping: mp,
					provider: providers.find((p) => p.id === mp.providerId),
				});
			}
		}
		return out;
	}, [models, providers]);

	// Get unique providers and capabilities for filtering
	const availableProviders = React.useMemo(() => {
		const ids = new Set(allEntries.map((e) => e.mapping.providerId));
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
		if (filters.hideUnstable) {
			list = list.filter((e) => {
				const providerStability = e.mapping.stability;
				const modelStability = e.model.stability;
				const effectiveStability = providerStability ?? modelStability;
				return (
					effectiveStability !== "unstable" &&
					effectiveStability !== "experimental"
				);
			});
		}
		if (searchQuery) {
			const normalize = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, "");
			const q = normalize(searchQuery);
			list = list.filter(({ model, provider }) => {
				const candidates = [
					model.name ?? "",
					model.family,
					model.id,
					provider?.name ?? "",
				];
				return candidates.some((c) => normalize(c).includes(q));
			});
		}
		if (filters.providers.length > 0) {
			list = list.filter((e) =>
				filters.providers.includes(e.mapping.providerId),
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
	}, [allEntries, searchQuery, filters]);

	const updateFilter = (key: keyof FilterState, value: any) => {
		setFilters((prev) => ({ ...prev, [key]: value }));
	};

	const toggleProviderFilter = (providerId: string) => {
		setFilters((prev) => ({
			...prev,
			providers: prev.providers.includes(providerId)
				? prev.providers.filter((id) => id !== providerId)
				: [...prev.providers, providerId],
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
		});
	};

	const hasActiveFilters =
		filters.providers.length > 0 ||
		filters.capabilities.length > 0 ||
		filters.priceRange !== "all" ||
		!filters.hideUnstable;

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
									const provider =
										selectedProviderDef ||
										getProviderForModel(selectedModel, providers);
									const ProviderIcon = provider
										? getProviderIcon(provider.id)
										: null;
									return ProviderIcon ? (
										<ProviderIcon
											className="h-5 w-5 flex-shrink-0"
											style={{ color: provider?.color }}
										/>
									) : null;
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
											return selectedMapping &&
												isModelUnstable(selectedMapping, selectedModel) ? (
												<AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-yellow-600 dark:text-yellow-500" />
											) : null;
										})()}
									</div>
									<span className="text-xs text-muted-foreground truncate max-w-full">
										{
											(
												selectedProviderDef ||
												getProviderForModel(selectedModel, providers)
											)?.name
										}
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
					className="w-[300px] sm:w-[600px] p-0"
					style={{ zIndex: 99999 }}
					sideOffset={4}
					align="start"
				>
					<div className="flex w-[300px] md:w-full">
						{/* Main content */}
						<div className="flex-1 w-[300px] md:w-full">
							<Command>
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
															onCheckedChange={(checked) =>
																updateFilter("hideUnstable", checked)
															}
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
										{filteredEntries.map(({ model, mapping, provider }) => {
											const ProviderIcon = provider
												? getProviderIcon(provider.id)
												: null;
											const entryKey = `${mapping.providerId}-${model.id}`;
											const isUnstable = isModelUnstable(mapping, model);
											return (
												<CommandItem
													key={entryKey}
													value={entryKey}
													onSelect={() => {
														onValueChange?.(
															`${mapping.providerId}/${model.id}`,
														);
														setOpen(false);
													}}
													className="p-2 sm:p-3 cursor-pointer"
												>
													<Check
														className={cn(
															"h-4 w-4",
															entryKey === selectedEntryKey
																? "opacity-100"
																: "opacity-0",
														)}
													/>
													<div className="flex items-center justify-between w-[250px] md:w-full gap-2">
														<div className="flex items-center gap-2 min-w-0 flex-1">
															{ProviderIcon ? (
																<ProviderIcon className="h-6 w-6 flex-shrink-0" />
															) : null}
															<div className="flex flex-col min-w-0 flex-1">
																<div className="flex items-center gap-1">
																	<span className="font-medium truncate">
																		{model.name}
																	</span>
																	{isUnstable && (
																		<AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-yellow-600 dark:text-yellow-500" />
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
															className="h-8 w-8 p-0 hover:bg-muted/50 flex-shrink-0"
															onClick={(e) => {
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
										})}
									</CommandGroup>
								</CommandList>
							</Command>
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
										const ProviderIcon = selectedDetails.provider
											? getProviderIcon(selectedDetails.provider.id)
											: null;
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
											{selectedDetails.provider?.name}
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
												{formatPrice(selectedDetails.mapping?.inputPrice)}
											</p>
										</div>
										<div className="space-y-1">
											<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
												Output
											</span>
											<p className="text-sm font-mono">
												{formatPrice(selectedDetails.mapping?.outputPrice)}
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
												{formatContextSize(selectedDetails.mapping?.maxOutput)}
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
													{formatPrice(
														selectedDetails.mapping.cachedInputPrice,
													)}
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
												{caps.map((capability) => (
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
									) : null;
								})()}
							</div>
						</>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
