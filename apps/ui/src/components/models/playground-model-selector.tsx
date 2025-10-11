"use client";

import { Check, ChevronsUpDown, Filter } from "lucide-react";
import * as React from "react";

// import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Checkbox } from "@/lib/components/checkbox";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/lib/components/command";
// import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/lib/components/hover-card";
import { Label } from "@/lib/components/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { getProviderIcon } from "@/lib/components/providers-icons";
import { Separator } from "@/lib/components/separator";
import { getProviderForModel } from "@/lib/model-utils";
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
}

// helper to extract simple capability labels from a mapping
function getMappingCapabilities(mapping?: ProviderModelMapping): string[] {
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
	if ((mapping as any).reasoning) {
		labels.push("Reasoning");
	}
	return labels;
}

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
	const [filters, setFilters] = React.useState<FilterState>({
		providers: [],
		capabilities: [],
		priceRange: "all",
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

	// Build entries of model per provider mapping
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

	const availableProviders = React.useMemo(() => {
		const ids = new Set(allEntries.map((e) => e.mapping.providerId));
		return providers.filter((p) => ids.has(p.id as any));
	}, [allEntries, providers]);

	const availableCapabilities = React.useMemo(() => {
		const set = new Set<string>();
		allEntries.forEach((e) =>
			getMappingCapabilities(e.mapping).forEach((c) => set.add(c)),
		);
		return Array.from(set).sort();
	}, [allEntries]);

	const filteredEntries = React.useMemo(() => {
		let list = allEntries;
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
				const caps = getMappingCapabilities(e.mapping);
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
		});
	};

	const hasActiveFilters =
		filters.providers.length > 0 ||
		filters.capabilities.length > 0 ||
		filters.priceRange !== "all";

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className="w-full justify-between h-12 px-4 bg-transparent"
				>
					{selectedModel ? (
						<div className="flex items-center gap-3">
							{(() => {
								const provider =
									selectedProviderDef ??
									getProviderForModel(selectedModel, providers);
								const ProviderIcon = provider
									? getProviderIcon(provider.id as string)
									: null;
								return ProviderIcon ? (
									<ProviderIcon
										className="h-5 w-5"
										style={{ color: (provider as any)?.color }}
									/>
								) : null;
							})()}
							<div className="flex flex-col items-start">
								<span className="font-medium max-w-40 truncate">
									{selectedModel.name}
								</span>
								<span className="text-xs text-muted-foreground">
									{
										(
											selectedProviderDef ??
											getProviderForModel(selectedModel, providers)
										)?.name
									}
								</span>
							</div>
						</div>
					) : (
						placeholder
					)}
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[600px] p-0"
				style={{ zIndex: 99999 }}
				sideOffset={4}
			>
				<div className="flex">
					{/* Main content */}
					<div className="flex-1">
						<Command>
							<div className="flex items-center border-b px-3 w-full">
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
										className="w-80"
										style={{ zIndex: 100000 }}
										side="right"
										align="start"
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
												<Label className="text-sm font-medium">Providers</Label>
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
														{ value: "high", label: "High cost (> $0.00001)" },
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
										</div>
									</PopoverContent>
								</Popover>
							</div>
							<CommandList className="max-h-[400px]">
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
										return (
											<CommandItem
												key={entryKey}
												value={entryKey}
												onSelect={() => {
													onValueChange?.(`${mapping.providerId}/${model.id}`);
													setOpen(false);
												}}
												className="p-3 cursor-pointer"
											>
												<Check
													className={cn(
														"h-4 w-4",
														entryKey === selectedEntryKey
															? "opacity-100"
															: "opacity-0",
													)}
												/>
												<div className="flex items-center justify-between w-full">
													<div className="flex items-center gap-2">
														{ProviderIcon ? (
															<ProviderIcon className="h-6 w-6 flex-shrink-0" />
														) : null}
														<div className="flex flex-col">
															<span className="font-medium">{model.name}</span>
															<span className="text-xs text-muted-foreground">
																{provider?.name}
															</span>
														</div>
													</div>
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
	);
}
