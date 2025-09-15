"use client";

import { Check, ChevronDown, AlertTriangle, X } from "lucide-react";
import { useState, useMemo, useCallback } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import { Input } from "@/lib/components/input";

import {
	models,
	providers,
	type ModelDefinition,
	type StabilityLevel,
} from "@llmgateway/models";

interface MultiModelSelectorProps {
	selectedModels: string[];
	onModelsChange: (models: string[]) => void;
	placeholder?: string;
}

interface LocalModel {
	id: string;
	name?: string;
	jsonOutput: boolean;
	stability?: StabilityLevel;
	providers: Array<{
		providerId: string;
		modelName: string;
		inputPrice?: number;
		outputPrice?: number;
		imageInputPrice?: number;
		requestPrice?: number;
		contextSize?: number;
		stability?: StabilityLevel;
		providerInfo?: {
			id: string;
			name: string;
			description: string;
			streaming?: boolean;
			cancellation?: boolean;
			jsonOutput?: boolean;
			color?: string;
		};
	}>;
}

export function MultiModelSelector({
	selectedModels,
	onModelsChange,
	placeholder = "Select models...",
}: MultiModelSelectorProps) {
	const [searchTerm, setSearchTerm] = useState("");

	const getProviderInfo = (providerId: string) => {
		return providers.find((p) => p.id === providerId);
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

	const getMostUnstableStability = (
		model: LocalModel,
	): StabilityLevel | undefined => {
		const stabilityLevels: StabilityLevel[] = [
			"experimental",
			"unstable",
			"beta",
			"stable",
		];

		// Get all stability levels (model-level and provider-level)
		const allStabilities = [
			model.stability,
			...model.providers.map((p) => p.stability || model.stability),
		].filter(Boolean) as StabilityLevel[];

		// Return the most unstable level
		for (const level of stabilityLevels) {
			if (allStabilities.includes(level)) {
				return level;
			}
		}

		return undefined;
	};

	// Group by model instead of provider to avoid duplicates
	const uniqueModels: LocalModel[] = models.map((model) => {
		const modelProviders = model.providers
			.map((provider) => {
				const providerInfo = getProviderInfo(provider.providerId);
				return {
					...provider,
					providerInfo,
				};
			})
			.filter((p) => p.providerInfo); // Filter out providers that don't exist

		const typedModel = model as ModelDefinition;
		return {
			id: typedModel.id,
			name: typedModel.name,
			jsonOutput: typedModel.jsonOutput ?? false,
			stability: typedModel.stability,
			providers: modelProviders,
		};
	});

	const normalizeString = (str: string) =>
		str.toLowerCase().replace(/[\s-_]/g, "");

	const filteredModels = useMemo(() => {
		if (!searchTerm) {
			return uniqueModels;
		}

		const normalizedSearch = normalizeString(searchTerm);

		return uniqueModels.filter((model) => {
			const modelId = normalizeString(model.id);
			const modelName = normalizeString(model.name || "");

			return (
				modelId.includes(normalizedSearch) ||
				modelName.includes(normalizedSearch)
			);
		});
	}, [searchTerm, uniqueModels]);

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
						const model = uniqueModels.find((m) => m.id === modelId);
						return (
							<Badge
								key={modelId}
								variant="secondary"
								className="flex items-center gap-1"
							>
								{model?.providers[0]?.providerInfo && (
									<div
										className="w-2 h-2 rounded-full"
										style={{
											backgroundColor: model.providers[0].providerInfo.color,
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

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" className="gap-2 w-full justify-between">
						<span className="text-left truncate">
							{selectedModels.length === 0
								? placeholder
								: `${selectedModels.length} model${selectedModels.length === 1 ? "" : "s"} selected`}
						</span>
						<ChevronDown className="h-4 w-4 opacity-50" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					className="w-80 max-h-96 p-0"
					onCloseAutoFocus={(e) => e.preventDefault()}
				>
					<div
						className="sticky top-0 bg-background border-b p-2"
						onClick={(e) => e.stopPropagation()}
					>
						<Input
							placeholder="Search models..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="h-8"
							onKeyDown={(e) => e.stopPropagation()}
							onFocus={(e) => e.stopPropagation()}
						/>
					</div>
					<div className="max-h-80 overflow-y-auto p-2">
						{filteredModels.map((model) => (
							<DropdownMenuItem
								key={model.id}
								onClick={() => handleModelToggle(model.id)}
								className="flex items-center justify-between py-3 cursor-pointer"
							>
								<div className="flex items-center gap-2">
									<div className="flex items-center gap-2">
										{model.providers.map((provider) => (
											<div
												key={provider.providerId}
												className="w-3 h-3 rounded-full"
												style={{
													backgroundColor: provider.providerInfo?.color,
												}}
												title={provider.providerInfo?.name}
											/>
										))}
									</div>
									<span className="font-medium">{model.name || model.id}</span>
									{shouldShowStabilityWarning(
										getMostUnstableStability(model),
									) && <AlertTriangle className="h-4 w-4 text-orange-500" />}
									{selectedModels.includes(model.id) && (
										<Check className="h-4 w-4 text-green-600" />
									)}
								</div>

								<div className="flex flex-col items-end text-xs text-muted-foreground">
									{model.providers[0]?.inputPrice !== null &&
										model.providers[0]?.inputPrice !== undefined && (
											<div>
												${(model.providers[0].inputPrice * 1e6).toFixed(2)}/1M
												tokens
											</div>
										)}
									{model.providers[0]?.requestPrice !== null &&
										model.providers[0]?.requestPrice !== undefined && (
											<div>
												${(model.providers[0].requestPrice * 1000).toFixed(2)}
												/1K requests
											</div>
										)}
									<div className="flex gap-1 mt-1">
										{model.jsonOutput && (
											<Badge variant="secondary" className="text-xs px-1 py-0">
												JSON
											</Badge>
										)}
										{model.providers.some((p) => p.providerInfo?.streaming) && (
											<Badge variant="secondary" className="text-xs px-1 py-0">
												Stream
											</Badge>
										)}
										{(() => {
											const mostUnstableStability =
												getMostUnstableStability(model);
											const stabilityProps = getStabilityBadgeProps(
												mostUnstableStability,
											);
											return stabilityProps ? (
												<Badge
													variant={stabilityProps.variant}
													className="text-xs px-1 py-0"
												>
													{stabilityProps.label}
												</Badge>
											) : null;
										})()}
									</div>
								</div>
							</DropdownMenuItem>
						))}
					</div>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
