"use client";

import {
	Check,
	ChevronsUpDown,
	Info,
	ExternalLink,
	Filter,
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
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
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
	getModelCapabilities,
} from "@/lib/model-utils";
import { cn } from "@/lib/utils";

import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";

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

const ModelItem = ({
	model,
	providers,
}: {
	model: ModelDefinition;
	providers: ProviderDefinition[];
}) => {
	const provider = getProviderForModel(model, providers);
	const ProviderIcon = provider ? getProviderIcon(provider.id) : null;
	const capabilities = getModelCapabilities(model);
	const primaryProvider = model.providers[0];

	return (
		<div className="flex items-center justify-between w-full">
			<div className="flex items-center gap-2">
				{ProviderIcon && <ProviderIcon className="h-6 w-6 flex-shrink-0" />}
				<div className="flex flex-col">
					<span className="font-medium">{model.name}</span>
					<span className="text-xs text-muted-foreground">
						{provider?.name}
					</span>
				</div>
			</div>

			<HoverCard>
				<HoverCardTrigger asChild>
					<Button variant="ghost" size="sm" className="p-0 hover:bg-muted/50">
						<Info className="h-3 w-3" />
					</Button>
				</HoverCardTrigger>
				<HoverCardContent className="w-96" side="right" align="start">
					<div className="space-y-4">
						<div className="flex items-start justify-between">
							<div className="flex items-center gap-3">
								{ProviderIcon && (
									<div
										className="p-2 rounded-lg"
										style={{ backgroundColor: `${provider?.color}15` }}
									>
										<ProviderIcon className="h-6 w-6" />
									</div>
								)}
								<div>
									<h4 className="font-semibold text-base">{model.name}</h4>
									<p className="text-sm text-muted-foreground">
										{provider?.name}
									</p>
									<p className="text-xs text-muted-foreground capitalize">
										{model.family} family
									</p>
								</div>
							</div>
							{provider?.website && (
								<Button variant="ghost" size="sm" asChild>
									<a
										href={provider.website}
										target="_blank"
										rel="noopener noreferrer"
										className="h-8 w-8 p-0"
									>
										<ExternalLink className="h-3 w-3" />
									</a>
								</Button>
							)}
						</div>

						{provider?.description && (
							<>
								<p className="text-sm text-muted-foreground leading-relaxed">
									{provider.description}
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
										{formatPrice(primaryProvider?.inputPrice)}
									</p>
								</div>
								<div className="space-y-1">
									<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
										Output
									</span>
									<p className="text-sm font-mono">
										{formatPrice(primaryProvider?.outputPrice)}
									</p>
								</div>
								<div className="space-y-1">
									<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
										Context
									</span>
									<p className="text-sm font-mono">
										{formatContextSize(primaryProvider?.contextSize)}
									</p>
								</div>
								<div className="space-y-1">
									<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
										Max Output
									</span>
									<p className="text-sm font-mono">
										{formatContextSize(primaryProvider?.maxOutput)}
									</p>
								</div>
							</div>

							{primaryProvider?.cachedInputPrice && (
								<div className="pt-2 border-t border-dashed">
									<div className="space-y-1">
										<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
											Cached Input
										</span>
										<p className="text-sm font-mono text-green-600 dark:text-green-400">
											{formatPrice(primaryProvider.cachedInputPrice)}
										</p>
									</div>
								</div>
							)}
						</div>

						<Separator />

						{capabilities.length > 0 && (
							<div className="space-y-2">
								<h5 className="font-medium text-sm">Capabilities</h5>
								<div className="flex flex-wrap gap-1.5">
									{capabilities.map((capability) => (
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

						{provider?.announcement && (
							<div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
								<div className="flex items-start gap-2">
									<div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
									<p className="text-sm text-blue-700 dark:text-blue-300 leading-relaxed">
										{provider.announcement}
									</p>
								</div>
							</div>
						)}

						<div className="pt-2 border-t border-dashed">
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<div className="flex items-center gap-3">
									{provider?.streaming && (
										<span className="flex items-center gap-1">
											<div className="w-1.5 h-1.5 rounded-full bg-green-500" />
											Streaming
										</span>
									)}
									{provider?.cancellation && (
										<span className="flex items-center gap-1">
											<div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
											Cancellation
										</span>
									)}
									{provider?.jsonOutput && (
										<span className="flex items-center gap-1">
											<div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
											JSON
										</span>
									)}
								</div>
							</div>
						</div>
					</div>
				</HoverCardContent>
			</HoverCard>
		</div>
	);
};

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

	const selectedModel = models.find((model) => model.id === value);

	// Get unique providers and capabilities for filtering
	const availableProviders = React.useMemo(() => {
		const providerIds = new Set(
			models.map((m) => m.providers[0]?.providerId).filter(Boolean),
		);
		return providers.filter((p) => providerIds.has(p.id as any));
	}, [models, providers]);

	const availableCapabilities = React.useMemo(() => {
		const capabilities = new Set<string>();
		models.forEach((model) => {
			getModelCapabilities(model).forEach((cap) => capabilities.add(cap));
		});
		return Array.from(capabilities).sort();
	}, [models]);

	const filteredModels = React.useMemo(() => {
		let filtered = models.filter((model) => model.id !== "custom");

		// Text search
		if (searchQuery) {
			const normalize = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, "");
			const q = normalize(searchQuery);
			filtered = filtered.filter((model) => {
				const provider = getProviderForModel(model, providers);
				const candidates = [
					model.name ?? "",
					model.family,
					provider?.name ?? "",
					model.id, // allow searching by exact model id
				];
				return candidates.some((c) => normalize(c).includes(q));
			});
		}

		// Provider filter
		if (filters.providers.length > 0) {
			filtered = filtered.filter((model) =>
				filters.providers.includes(model.providers[0]?.providerId),
			);
		}

		// Capabilities filter
		if (filters.capabilities.length > 0) {
			filtered = filtered.filter((model) => {
				const modelCapabilities = getModelCapabilities(model);
				return filters.capabilities.every((cap) =>
					modelCapabilities.includes(cap),
				);
			});
		}

		// Price range filter
		if (filters.priceRange !== "all") {
			filtered = filtered.filter((model) => {
				const inputPrice = model.providers[0]?.inputPrice || 0;
				switch (filters.priceRange) {
					case "free":
						return inputPrice === 0;
					case "low":
						return inputPrice > 0 && inputPrice <= 0.000001;
					case "medium":
						return inputPrice > 0.000001 && inputPrice <= 0.00001;
					case "high":
						return inputPrice > 0.00001;
					default:
						return true;
				}
			});
		}

		return filtered;
	}, [models, providers, searchQuery, filters]);

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
								const provider = getProviderForModel(selectedModel, providers);
								const ProviderIcon = provider
									? getProviderIcon(provider.id)
									: null;
								return ProviderIcon ? (
									<ProviderIcon
										className="h-5 w-5"
										style={{ color: provider?.color }}
									/>
								) : null;
							})()}
							<div className="flex flex-col items-start">
								<span className="font-medium max-w-40 truncate">
									{selectedModel.name}
								</span>
								<span className="text-xs text-muted-foreground">
									{getProviderForModel(selectedModel, providers)?.name}
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
										{filteredModels.length} model
										{filteredModels.length !== 1 ? "s" : ""} found
									</div>
									{filteredModels.map((model) => (
										<CommandItem
											key={model.id}
											value={model.id}
											onSelect={(currentValue) => {
												onValueChange?.(currentValue);
												setOpen(false);
											}}
											className="p-3 cursor-pointer"
										>
											<Check
												className={cn(
													"h-4 w-4",
													value === model.id ? "opacity-100" : "opacity-0",
												)}
											/>
											<ModelItem model={model} providers={providers} />
										</CommandItem>
									))}
								</CommandGroup>
							</CommandList>
						</Command>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
