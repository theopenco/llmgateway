"use client";
import {
	ExternalLink,
	Plus,
	GitBranch,
	Filter,
	Zap,
	Eye,
	Wrench,
	MessageSquare,
	Braces,
	ImagePlus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ModelCard } from "@/components/models/model-card";
import { Button } from "@/lib/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useAppConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
	type ProviderModelMapping,
	type ProviderId,
	type StabilityLevel,
} from "@llmgateway/models";
import {
	getProviderIcon,
	providerLogoUrls,
} from "@llmgateway/shared/components";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "@/lib/fetch-models";

interface ModelWithProviders extends ApiModel {
	providerDetails: Array<{
		provider: ApiModelProviderMapping;
		providerInfo: ApiProvider;
	}>;
}

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

const getProviderLogoSmall = (providerId: ProviderId) => {
	const LogoComponent = providerLogoUrls[providerId];

	if (LogoComponent) {
		return <LogoComponent className="h-5 w-5 object-contain" />;
	}

	const IconComponent = getProviderIcon(providerId);
	return IconComponent ? (
		<IconComponent className="h-5 w-5" />
	) : (
		<div className="h-5 w-5 bg-gray-200 rounded" />
	);
};

// Convert static ModelDefinition to ApiModel-like structure
const convertToApiModel = (
	def: ModelDefinition,
	map: ProviderModelMapping,
): ModelWithProviders => {
	const provider = providerDefinitions.find((p) => p.id === map.providerId)!;
	return {
		id: def.id,
		createdAt: new Date().toISOString(),
		releasedAt: def.releasedAt?.toISOString() ?? null,
		name: def.name ?? null,
		aliases: def.aliases ?? null,
		description: def.description ?? null,
		family: def.family,
		free: def.free ?? null,
		output: def.output ?? null,
		stability: def.stability ?? null,
		status: "active",
		mappings: [],
		providerDetails: [
			{
				provider: {
					id: `${map.providerId}-${def.id}`,
					createdAt: new Date().toISOString(),
					modelId: def.id,
					providerId: map.providerId,
					modelName: map.modelName,
					inputPrice: map.inputPrice?.toString() ?? null,
					outputPrice: map.outputPrice?.toString() ?? null,
					cachedInputPrice: map.cachedInputPrice?.toString() ?? null,
					imageInputPrice: map.imageInputPrice?.toString() ?? null,
					requestPrice: map.requestPrice?.toString() ?? null,
					contextSize: map.contextSize ?? null,
					maxOutput: map.maxOutput ?? null,
					streaming: map.streaming ?? true,
					vision: map.vision ?? null,
					reasoning: map.reasoning ?? null,
					reasoningOutput: map.reasoningOutput ?? null,
					reasoningMaxTokens: map.reasoningMaxTokens ?? null,
					tools: map.tools ?? null,
					jsonOutput: map.jsonOutput ?? null,
					jsonOutputSchema: map.jsonOutputSchema ?? null,
					webSearch: map.webSearch ?? null,
					webSearchPrice: map.webSearchPrice?.toString() ?? null,
					discount: map.discount?.toString() ?? null,
					stability: map.stability ?? null,
					supportedParameters: map.supportedParameters ?? null,
					deprecatedAt: map.deprecatedAt?.toISOString() ?? null,
					deactivatedAt: map.deactivatedAt?.toISOString() ?? null,
					status: "active",
				},
				providerInfo: {
					id: provider.id,
					createdAt: new Date().toISOString(),
					name: provider.name ?? null,
					description: provider.description ?? null,
					streaming: provider.streaming ?? null,
					cancellation: provider.cancellation ?? null,
					color: provider.color ?? null,
					website: provider.website ?? null,
					announcement: provider.announcement ?? null,
					status: "active",
				},
			},
		],
	};
};

const groupedProviders = modelDefinitions.reduce<
	Record<string, ModelWithProviders[]>
>((acc, def) => {
	def.providers.forEach((map) => {
		const provider = providerDefinitions.find((p) => p.id === map.providerId)!;
		if (!acc[provider.name]) {
			acc[provider.name] = [];
		}
		acc[provider.name].push(convertToApiModel(def, map));
	});
	return acc;
}, {});

const sortedProviderEntries = Object.entries(groupedProviders)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([providerName, models]) => [providerName, [...models].reverse()]) as [
	string,
	ModelWithProviders[],
][];

const totalModels = modelDefinitions.length;
const totalProviders = sortedProviderEntries.length;

export const ModelsSupported = ({ isDashboard }: { isDashboard?: boolean }) => {
	const config = useAppConfig();
	const router = useRouter();
	const [selectedProvider, setSelectedProvider] = useState<string>("all");

	const getCapabilityIcons = (
		providerMapping: ApiModelProviderMapping,
		model?: ApiModel,
	) => {
		const capabilities = [];
		if (providerMapping.streaming) {
			capabilities.push({
				icon: Zap,
				label: "Streaming",
				color: "text-blue-500",
			});
		}
		if (providerMapping.vision) {
			capabilities.push({
				icon: Eye,
				label: "Vision",
				color: "text-green-500",
			});
		}
		if (providerMapping.tools) {
			capabilities.push({
				icon: Wrench,
				label: "Tools",
				color: "text-purple-500",
			});
		}
		if (providerMapping.reasoning) {
			capabilities.push({
				icon: MessageSquare,
				label: "Reasoning",
				color: "text-orange-500",
			});
		}
		if (providerMapping.jsonOutput) {
			capabilities.push({
				icon: Braces,
				label: "JSON Output",
				color: "text-cyan-500",
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

	const shouldShowStabilityWarning = (
		stability?: StabilityLevel | null,
	): boolean | undefined => {
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

	// Filter providers based on selection
	const filteredProviderEntries =
		selectedProvider === "all"
			? sortedProviderEntries.filter(
					([providerName]) => providerName !== "LLM Gateway",
				)
			: sortedProviderEntries.filter(
					([providerName]) =>
						providerName !== "LLM Gateway" && providerName === selectedProvider,
				);

	// Calculate filtered counts
	const filteredModelsCount = filteredProviderEntries.reduce(
		(sum, [, models]) => sum + models.length,
		0,
	);
	const filteredProvidersCount = filteredProviderEntries.length;

	return (
		<div className={cn(!isDashboard && "container mx-auto px-4 pt-60 pb-8")}>
			{!isDashboard ? (
				<header className="text-center mb-12">
					<h1 className="text-4xl font-bold tracking-tight mb-4">
						Supported AI Providers & Models
					</h1>
					<p className="text-xl text-muted-foreground mb-6 max-w-3xl mx-auto">
						Access {totalModels} models from {totalProviders} leading AI
						providers through our unified API
					</p>
					<div className="flex justify-center gap-8 text-sm text-muted-foreground mb-8">
						<div className="flex items-center gap-2">
							<div className="w-2 h-2 bg-green-500 rounded-full" />
							<span>{totalProviders} Providers</span>
						</div>
						<div className="flex items-center gap-2">
							<div className="w-2 h-2 bg-blue-500 rounded-full" />
							<span>{totalModels} Models</span>
						</div>
					</div>
					<div className="flex justify-center gap-4 flex-col md:flex-row">
						<Button variant="outline" asChild>
							<a
								href="https://github.com/theopenco/llmgateway/issues/new?assignees=&labels=enhancement%2Cmodel-request&projects=&template=model-request.md&title=%5BModel+Request%5D+"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-2"
							>
								<Plus className="h-4 w-4" />
								Request New Model
							</a>
						</Button>
						<Button variant="outline" asChild>
							<a
								href="https://github.com/theopenco/llmgateway/issues/new?assignees=&labels=enhancement%2Cprovider-request&projects=&template=provider-request.md&title=%5BProvider+Request%5D+"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-2"
							>
								<GitBranch className="h-4 w-4" />
								Request New Provider
							</a>
						</Button>
					</div>
				</header>
			) : (
				<div className="mb-10">
					<div className="flex items-start md:items-center justify-between mb-6 flex-col md:flex-row">
						<p className="text-xl text-muted-foreground max-w-3xl">
							Access {totalModels} models from {totalProviders} leading AI
							providers through our unified API
						</p>
						<div className="flex gap-2 mt-4 md:mt-0">
							<Button variant="outline" size="sm" asChild>
								<a
									href="https://github.com/theopenco/llmgateway/issues/new?assignees=&labels=enhancement%2Cmodel-request&projects=&template=model-request.md&title=%5BModel+Request%5D+"
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-2"
								>
									<Plus className="h-4 w-4" />
									Request Model
								</a>
							</Button>
							<Button variant="outline" size="sm" asChild>
								<a
									href="https://github.com/theopenco/llmgateway/issues/new?assignees=&labels=enhancement%2Cprovider-request&projects=&template=provider-request.md&title=%5BProvider+Request%5D+"
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-2"
								>
									<GitBranch className="h-4 w-4" />
									Request Provider
								</a>
							</Button>
						</div>
					</div>
					<div className="flex justify-start gap-8 text-sm text-muted-foreground">
						<div className="flex items-center gap-2">
							<div className="w-2 h-2 bg-green-500 rounded-full" />
							<span>{totalProviders} Providers</span>
						</div>
						<div className="flex items-center gap-2">
							<div className="w-2 h-2 bg-blue-500 rounded-full" />
							<span>{totalModels} Models</span>
						</div>
					</div>
				</div>
			)}

			{/* Filter Section */}
			<div className="mb-8">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-4">
						{selectedProvider !== "all" && (
							<div className="flex gap-4 text-sm text-muted-foreground">
								<div className="flex items-center gap-2">
									<div className="w-2 h-2 bg-blue-500 rounded-full" />
									<span>
										Showing {filteredModelsCount} models from{" "}
										{filteredProvidersCount} provider
									</span>
								</div>
							</div>
						)}
					</div>
					<div className="flex items-center gap-4">
						<div className="flex items-center gap-2">
							<Filter className="h-4 w-4 text-muted-foreground" />
							<span className="text-sm font-medium">Filter by Provider:</span>
						</div>
						<Select
							value={selectedProvider}
							onValueChange={setSelectedProvider}
						>
							<SelectTrigger className="w-[200px]">
								<SelectValue placeholder="Select provider" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">
									<div className="flex items-center gap-2">
										<div className="w-5 h-5 bg-muted rounded flex items-center justify-center">
											<Filter className="h-3 w-3" />
										</div>
										<span>All Providers</span>
									</div>
								</SelectItem>
								{sortedProviderEntries
									.filter(([providerName]) => providerName !== "LLM Gateway")
									.map(([providerName, models]) => {
										const providerId = models[0].providerDetails[0].provider
											.providerId as ProviderId;
										return (
											<SelectItem key={providerName} value={providerName}>
												<div className="flex items-center gap-2">
													<div className="w-5 h-5 flex items-center justify-center">
														{getProviderLogoSmall(providerId)}
													</div>
													<span>{providerName}</span>
												</div>
											</SelectItem>
										);
									})}
							</SelectContent>
						</Select>
						{selectedProvider !== "all" && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setSelectedProvider("all")}
							>
								Clear Filter
							</Button>
						)}
					</div>
				</div>
			</div>

			<section className="space-y-12">
				{filteredProviderEntries.map(([providerName, models]) => {
					const providerId = models[0].providerDetails[0].provider
						.providerId as ProviderId;
					return (
						<div key={providerName} className="space-y-6">
							<Link
								href={`/providers/${providerId}`}
								className="flex items-center gap-3 hover:opacity-80 transition-opacity"
								prefetch={true}
							>
								{getProviderLogo(providerId)}
								<h2 className="text-2xl font-semibold">{providerName}</h2>
								<span className="text-sm text-muted-foreground">
									{models.length} model{models.length !== 1 && "s"}
								</span>
							</Link>
							<div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
								{models.map((model, index) => (
									<ModelCard
										key={`${model.providerDetails[0].provider.providerId}-${model.id}-${index}`}
										model={model}
										shouldShowStabilityWarning={shouldShowStabilityWarning}
										getCapabilityIcons={getCapabilityIcons}
										goToModel={() =>
											router.push(`/models/${encodeURIComponent(model.id)}`)
										}
										formatPrice={formatPrice}
									/>
								))}
							</div>
						</div>
					);
				})}
			</section>

			{filteredProviderEntries.length === 0 && (
				<div className="text-center py-12">
					<p className="text-muted-foreground">
						No providers match the selected filter.
					</p>
				</div>
			)}

			<footer className="mt-16 text-center">
				<a
					href={`${config.docsUrl}/v1_models`}
					target="_blank"
					className="inline-flex items-center gap-2 text-sm text-muted-foreground"
				>
					<span>Data sourced from @llmgateway/models</span>
					<ExternalLink className="w-4 h-4" />
				</a>
			</footer>
		</div>
	);
};
