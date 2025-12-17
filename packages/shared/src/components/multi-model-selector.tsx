"use client";

import { Check, ChevronDown, AlertTriangle, X } from "lucide-react";
import { useState, useMemo, useCallback } from "react";

import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared/components";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

import type {
	ModelDefinition,
	ProviderDefinition,
	StabilityLevel,
} from "@llmgateway/models";

interface MultiModelSelectorProps {
	models: readonly ModelDefinition[];
	providers: readonly ProviderDefinition[];
	selectedModels: string[];
	onModelsChange: (models: string[]) => void;
	placeholder?: string;
}

function getStabilityBadgeProps(stability?: StabilityLevel) {
	switch (stability) {
		case "beta":
			return {
				variant: "secondary" as const,
				className: "text-blue-600",
				label: "BETA",
			};
		case "unstable":
			return {
				variant: "destructive" as const,
				className: "text-red-600",
				label: "UNSTABLE",
			};
		case "experimental":
			return {
				variant: "destructive" as const,
				className: "text-orange-600",
				label: "EXPERIMENTAL",
			};
		default:
			return null;
	}
}

function shouldShowStabilityWarning(stability?: StabilityLevel) {
	return stability && ["unstable", "experimental"].includes(stability);
}

function getMostUnstableStability(
	model: ModelDefinition,
): StabilityLevel | undefined {
	const stabilityLevels: StabilityLevel[] = [
		"experimental",
		"unstable",
		"beta",
		"stable",
	];

	const allStabilities = [
		model.stability,
		...model.providers.map((p) => p.stability || model.stability),
	].filter(Boolean) as StabilityLevel[];

	for (const level of stabilityLevels) {
		if (allStabilities.includes(level)) {
			return level;
		}
	}

	return undefined;
}

export function MultiModelSelector({
	models,
	providers,
	selectedModels,
	onModelsChange,
	placeholder = "Select models...",
}: MultiModelSelectorProps) {
	const [open, setOpen] = useState(false);

	const getProviderInfo = useCallback(
		(providerId: string) => {
			return providers.find((p) => p.id === providerId);
		},
		[providers],
	);

	const modelsWithProviderInfo = useMemo(() => {
		return [...models]
			.sort((a, b) => {
				const dateA = a.releasedAt ? new Date(a.releasedAt).getTime() : 0;
				const dateB = b.releasedAt ? new Date(b.releasedAt).getTime() : 0;
				return dateB - dateA;
			})
			.map((model) => ({
				...model,
				providersWithInfo: model.providers.map((provider) => ({
					...provider,
					providerInfo: getProviderInfo(provider.providerId),
				})),
			}));
	}, [models, getProviderInfo]);

	const handleModelToggle = useCallback(
		(modelId: string) => {
			const isSelected = selectedModels.includes(modelId);
			if (isSelected) {
				onModelsChange(selectedModels.filter((id) => id !== modelId));
			} else {
				onModelsChange([...selectedModels, modelId]);
			}
		},
		[selectedModels, onModelsChange],
	);

	const removeModel = useCallback(
		(modelId: string) => {
			onModelsChange(selectedModels.filter((id) => id !== modelId));
		},
		[selectedModels, onModelsChange],
	);

	return (
		<div className="space-y-2">
			{selectedModels.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{selectedModels.map((modelId) => {
						const model = modelsWithProviderInfo.find((m) => m.id === modelId);
						const firstProvider = model?.providersWithInfo[0];
						return (
							<Badge
								key={modelId}
								variant="secondary"
								className="flex items-center gap-1"
							>
								{firstProvider?.providerInfo && (
									<div
										className="w-2 h-2 rounded-full"
										style={{
											backgroundColor: firstProvider.providerInfo.color,
										}}
									/>
								)}
								{model?.name || modelId}
								<Button
									variant="ghost"
									size="sm"
									className="h-3 w-3 p-0 hover:bg-transparent"
									onClick={() => removeModel(modelId)}
								>
									<X className="h-2 w-2" />
								</Button>
							</Badge>
						);
					})}
				</div>
			)}

			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						role="combobox"
						aria-expanded={open}
						className="w-full justify-between"
					>
						<span className="text-left truncate">
							{selectedModels.length === 0
								? placeholder
								: `${selectedModels.length} model${selectedModels.length === 1 ? "" : "s"} selected`}
						</span>
						<ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-80 p-0 max-h-[400px]" align="start">
					<Command className="flex flex-col">
						<CommandInput placeholder="Search models..." />
						<div className="max-h-[300px] overflow-y-auto">
							<CommandList className="overflow-y-scroll">
								<CommandEmpty>No models found.</CommandEmpty>
								{modelsWithProviderInfo.map((model) => {
									const isSelected = selectedModels.includes(model.id);
									const mostUnstableStability = getMostUnstableStability(model);
									const stabilityProps = getStabilityBadgeProps(
										mostUnstableStability,
									);

									return (
										<CommandItem
											key={model.id}
											value={`${model.id} ${model.name || ""}`}
											onSelect={() => handleModelToggle(model.id)}
											className="flex items-center justify-between py-3 cursor-pointer"
										>
											<div className="flex items-center gap-2">
												<div className="flex items-center gap-1">
													{model.providersWithInfo
														.slice(0, 3)
														.map((provider) => {
															const ProviderIcon = getProviderIcon(
																provider.providerId,
															);
															return ProviderIcon ? (
																<ProviderIcon
																	key={`${provider.providerId}-${provider.modelName}`}
																	className="h-4 w-4"
																/>
															) : null;
														})}
												</div>
												<span className="font-medium">
													{model.name || model.id}
												</span>
												{shouldShowStabilityWarning(mostUnstableStability) && (
													<AlertTriangle className="h-4 w-4 text-orange-500" />
												)}
											</div>

											<div className="flex items-center gap-2">
												{stabilityProps && (
													<Badge
														variant={stabilityProps.variant}
														className={cn(
															"text-xs px-1 py-0",
															stabilityProps.className,
														)}
													>
														{stabilityProps.label}
													</Badge>
												)}
												{isSelected && (
													<Check className="h-4 w-4 text-green-600" />
												)}
											</div>
										</CommandItem>
									);
								})}
							</CommandList>
						</div>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
