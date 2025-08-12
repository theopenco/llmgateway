"use client";

import { models, providers } from "@llmgateway/models";
import {
	Check,
	Copy,
	Eye,
	MessageSquare,
	Wrench,
	Zap,
	Grid,
	List,
	Search,
	Filter,
	X,
} from "lucide-react";
import React, { useMemo, useState } from "react";

import Footer from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { getProviderIcon } from "@/components/ui/providers-icons";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Checkbox } from "@/lib/components/checkbox";
import { Input } from "@/lib/components/input";
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
import { formatContextSize } from "@/lib/utils";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

interface ModelWithProviders extends ModelDefinition {
	providerDetails: Array<{
		provider: ProviderModelMapping;
		providerInfo: (typeof providers)[number];
	}>;
}

export function AllModels() {
	const [viewMode, setViewMode] = useState<"table" | "grid">("table");
	const [copiedModel, setCopiedModel] = useState<string | null>(null);

	// Search and filter states
	const [searchQuery, setSearchQuery] = useState("");
	const [showFilters, setShowFilters] = useState(false);
	const [filters, setFilters] = useState({
		capabilities: {
			streaming: false,
			vision: false,
			tools: false,
			reasoning: false,
		},
		inputPrice: {
			min: "",
			max: "",
		},
		outputPrice: {
			min: "",
			max: "",
		},
		contextSize: {
			min: "",
			max: "",
		},
	});

	const modelsWithProviders: ModelWithProviders[] = useMemo(() => {
		const baseModels = (models as readonly ModelDefinition[])
			.filter((model) => model.id !== "custom" && model.id !== "auto") // Filter out Custom Model and Auto Route
			.map((model) => ({
				...model,
				providerDetails: model.providers.map((provider) => ({
					provider,
					providerInfo: providers.find((p) => p.id === provider.providerId)!,
				})),
			}));

		return baseModels.filter((model) => {
			// Search filter
			if (searchQuery) {
				const query = searchQuery.toLowerCase();
				const matchesName = (model.name || model.id)
					.toLowerCase()
					.includes(query);
				const matchesId = model.id.toLowerCase().includes(query);
				const matchesFamily = model.family.toLowerCase().includes(query);
				if (!matchesName && !matchesId && !matchesFamily) {
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
					const minSize = min ? parseInt(min) : 0;
					const maxSize = max ? parseInt(max) : Infinity;
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
	}, [searchQuery, filters]);

	const copyToClipboard = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedModel(text);
			setTimeout(() => setCopiedModel(null), 2000);
		} catch (err) {
			console.error("Failed to copy text:", err);
		}
	};

	const formatPrice = (price: number | undefined) => {
		if (price === undefined) {
			return "—";
		}
		return `$${(price * 1e6).toFixed(2)}`;
	};

	const getCapabilityIcons = (provider: ProviderModelMapping) => {
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
			},
			inputPrice: { min: "", max: "" },
			outputPrice: { min: "", max: "" },
			contextSize: { min: "", max: "" },
		});
	};

	const hasActiveFilters =
		searchQuery ||
		Object.values(filters.capabilities).some(Boolean) ||
		filters.inputPrice.min ||
		filters.inputPrice.max ||
		filters.outputPrice.min ||
		filters.outputPrice.max ||
		filters.contextSize.min ||
		filters.contextSize.max;

	const renderFilters = () => (
		<Card
			className={`transition-all duration-200 ${showFilters ? "opacity-100" : "opacity-0 hidden"}`}
		>
			<CardContent className="pt-6">
				<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
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
							].map(({ key, label, icon: Icon, color }) => (
								<div key={key} className="flex items-center space-x-2">
									<Checkbox
										id={key}
										checked={
											filters.capabilities[
												key as keyof typeof filters.capabilities
											]
										}
										onCheckedChange={(checked) =>
											setFilters((prev) => ({
												...prev,
												capabilities: {
													...prev.capabilities,
													[key]: checked === true,
												},
											}))
										}
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
						<h3 className="font-medium text-sm">Input Price ($/M tokens)</h3>
						<div className="space-y-2">
							<Input
								placeholder="Min price"
								type="number"
								value={filters.inputPrice.min}
								onChange={(e) =>
									setFilters((prev) => ({
										...prev,
										inputPrice: { ...prev.inputPrice, min: e.target.value },
									}))
								}
								className="h-8"
							/>
							<Input
								placeholder="Max price"
								type="number"
								value={filters.inputPrice.max}
								onChange={(e) =>
									setFilters((prev) => ({
										...prev,
										inputPrice: { ...prev.inputPrice, max: e.target.value },
									}))
								}
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
								onChange={(e) =>
									setFilters((prev) => ({
										...prev,
										outputPrice: { ...prev.outputPrice, min: e.target.value },
									}))
								}
								className="h-8"
							/>
							<Input
								placeholder="Max price"
								type="number"
								value={filters.outputPrice.max}
								onChange={(e) =>
									setFilters((prev) => ({
										...prev,
										outputPrice: { ...prev.outputPrice, max: e.target.value },
									}))
								}
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
								onChange={(e) =>
									setFilters((prev) => ({
										...prev,
										contextSize: { ...prev.contextSize, min: e.target.value },
									}))
								}
								className="h-8"
							/>
							<Input
								placeholder="Max size (e.g., 200000)"
								type="number"
								value={filters.contextSize.max}
								onChange={(e) =>
									setFilters((prev) => ({
										...prev,
										contextSize: { ...prev.contextSize, max: e.target.value },
									}))
								}
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
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-[250px]">Model</TableHead>
						<TableHead>Providers</TableHead>
						<TableHead className="text-center">Context Size</TableHead>
						<TableHead className="text-center">Input Price</TableHead>
						<TableHead className="text-center">Output Price</TableHead>
						<TableHead className="text-center">Capabilities</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{modelsWithProviders.map((model) => (
						<TableRow key={model.id}>
							<TableCell className="font-medium">
								<div className="space-y-1">
									<div className="font-semibold text-sm">
										{model.name || model.id}
									</div>
									<div className="text-xs text-muted-foreground">
										Family:{" "}
										<Badge variant="outline" className="text-xs">
											{model.family}
										</Badge>
									</div>
									<div className="flex items-center gap-1">
										<code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
											{model.id}
										</code>
										<Button
											variant="ghost"
											size="sm"
											className="h-5 w-5 p-0"
											onClick={() => copyToClipboard(model.id)}
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
								<div className="flex flex-wrap gap-2">
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
										</div>
									))}
								</div>
							</TableCell>

							<TableCell className="text-center">
								<div className="space-y-1">
									{model.providerDetails.map(({ provider, providerInfo }) => (
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
									{model.providerDetails.map(({ provider, providerInfo }) => (
										<div
											key={provider.providerId}
											className="text-sm font-mono"
										>
											{formatPrice(provider.inputPrice)}/M
										</div>
									))}
								</div>
							</TableCell>

							<TableCell className="text-center">
								<div className="space-y-1">
									{model.providerDetails.map(({ provider, providerInfo }) => (
										<div
											key={provider.providerId}
											className="text-sm font-mono"
										>
											{formatPrice(provider.outputPrice)}/M
										</div>
									))}
								</div>
							</TableCell>

							<TableCell className="text-center">
								<div className="space-y-2">
									{model.providerDetails.map(({ provider, providerInfo }) => (
										<div
											key={provider.providerId}
											className="flex justify-center gap-1"
										>
											{getCapabilityIcons(provider).map(
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
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);

	const renderGridView = () => (
		<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
			{modelsWithProviders.map((model) => (
				<Card key={model.id} className="flex flex-col">
					<CardHeader>
						<div className="flex items-start justify-between gap-2">
							<div className="flex-1 min-w-0">
								<CardTitle className="text-base leading-tight">
									{model.name || model.id}
								</CardTitle>
								<CardDescription className="text-sm mt-1">
									<Badge variant="outline" className="text-xs">
										{model.family}
									</Badge>
								</CardDescription>
							</div>
						</div>
					</CardHeader>

					<CardContent className="flex-1 space-y-4">
						<div className="flex items-center justify-between gap-2">
							<code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all flex-1">
								{model.id}
							</code>
							<Button
								variant="ghost"
								size="sm"
								className="h-6 w-6 p-0 shrink-0"
								onClick={() => copyToClipboard(model.id)}
								title="Copy model ID"
							>
								{copiedModel === model.id ? (
									<Check className="h-3 w-3 text-green-600" />
								) : (
									<Copy className="h-3 w-3" />
								)}
							</Button>
						</div>

						<div className="space-y-3">
							<div>
								<div className="text-sm font-medium mb-2">Providers:</div>
								<div className="flex flex-wrap gap-2">
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
										</div>
									))}
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4 text-sm">
								<div>
									<div className="font-medium mb-1">Context Size:</div>
									{model.providerDetails.map(({ provider, providerInfo }) => (
										<div
											key={provider.providerId}
											className="text-muted-foreground"
										>
											{provider.contextSize
												? formatContextSize(provider.contextSize)
												: "—"}
										</div>
									))}
								</div>

								<div>
									<div className="font-medium mb-1">Pricing:</div>
									{model.providerDetails.map(({ provider, providerInfo }) => (
										<div
											key={provider.providerId}
											className="text-muted-foreground text-xs"
										>
											In: {formatPrice(provider.inputPrice)}/M
											<br />
											Out: {formatPrice(provider.outputPrice)}/M
										</div>
									))}
								</div>
							</div>

							<div>
								<div className="font-medium mb-2 text-sm">Capabilities:</div>
								{model.providerDetails.map(({ provider, providerInfo }) => (
									<div key={provider.providerId} className="flex gap-2 mb-1">
										{getCapabilityIcons(provider).map(
											({ icon: Icon, label, color }) => (
												<Tooltip key={label}>
													<TooltipTrigger asChild>
														<div
															className="flex items-center gap-1 cursor-help focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm p-1 -m-1"
															tabIndex={0}
															role="button"
															aria-label={`Model capability: ${label}`}
														>
															<Icon className={`h-4 w-4 ${color}`} />
															<span className="text-xs text-muted-foreground">
																{label}
															</span>
														</div>
													</TooltipTrigger>
													<TooltipContent
														className="bg-popover text-popover-foreground border border-border shadow-md"
														side="top"
														align="center"
														avoidCollisions={true}
													>
														<p>Model supports {label.toLowerCase()}</p>
													</TooltipContent>
												</Tooltip>
											),
										)}
									</div>
								))}
							</div>
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);

	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<Hero navbarOnly />
				<div className="container mx-auto px-4 md:px-0 pb-8 pt-40 space-y-6">
					<TooltipProvider delayDuration={300} skipDelayDuration={100}>
						<div className="container mx-auto py-8 space-y-6">
							<div className="flex items-center justify-between">
								<div>
									<h1 className="text-3xl font-bold">Models</h1>
									<p className="text-muted-foreground mt-2">
										Comprehensive list of all supported models and their
										providers
									</p>
								</div>

								<div className="flex items-center gap-2">
									<Button
										variant={viewMode === "table" ? "default" : "outline"}
										size="sm"
										onClick={() => setViewMode("table")}
									>
										<List className="h-4 w-4 mr-1" />
										Table
									</Button>
									<Button
										variant={viewMode === "grid" ? "default" : "outline"}
										size="sm"
										onClick={() => setViewMode("grid")}
									>
										<Grid className="h-4 w-4 mr-1" />
										Grid
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
											onChange={(e) => setSearchQuery(e.target.value)}
											className="pl-8"
										/>
									</div>
									<Button
										variant="outline"
										size="sm"
										onClick={() => setShowFilters(!showFilters)}
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

							<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
								<Card>
									<CardContent className="p-4">
										<div className="text-2xl font-bold">
											{modelsWithProviders.length}
										</div>
										<div className="text-sm text-muted-foreground">
											Total Models
										</div>
									</CardContent>
								</Card>
								<Card>
									<CardContent className="p-4">
										<div className="text-2xl font-bold">{providers.length}</div>
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
