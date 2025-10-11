"use client";
import {
	ExternalLink,
	Copy,
	Check,
	Plus,
	GitBranch,
	Filter,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { getProviderIcon } from "@/lib/components/providers-icons";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useAppConfig } from "@/lib/config";
import { cn, formatContextSize } from "@/lib/utils";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ProviderId,
} from "@llmgateway/models";

import { providerLogoUrls } from "./provider-keys/provider-logo";

interface ProviderModel {
	id: string;
	providerId: ProviderId;
	providerName: string;
	inputPrice?: number;
	outputPrice?: number;
	requestPrice?: number;
	contextSize?: number;
}

// Component for rendering individual provider-model cards
interface ProviderModelCardProps {
	model: ProviderModel;
	copiedText: string | null;
	onCopy: (text: string) => void;
}

function ProviderModelCard({
	model,
	copiedText,
	onCopy,
}: ProviderModelCardProps) {
	const providerModelName = `${model.providerId}/${model.id}`;

	return (
		<Card
			key={`${model.providerId}-${model.id}`}
			className="flex flex-col h-full hover:shadow-md transition-shadow"
		>
			<CardHeader className="pb-2">
				<div className="flex items-start justify-between gap-2">
					<div className="flex-1 min-w-0">
						<CardTitle className="text-base leading-tight line-clamp-1">
							{model.id}
						</CardTitle>
						<CardDescription className="text-xs">
							{model.providerName}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="mt-auto space-y-2">
				{/* Model Name Copy Section */}
				<div className="flex items-center justify-between gap-2">
					<div className="flex-1 min-w-0">
						<code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all">
							{providerModelName}
						</code>
					</div>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 w-6 p-0 shrink-0"
						onClick={() => onCopy(providerModelName)}
						title="Copy provider/model name"
					>
						{copiedText === providerModelName ? (
							<Check className="h-3 w-3 text-green-600" />
						) : (
							<Copy className="h-3 w-3" />
						)}
					</Button>
				</div>

				{model.contextSize && (
					<p className="text-xs text-muted-foreground">
						Context:{" "}
						<span className="font-mono text-foreground font-bold">
							{formatContextSize(model.contextSize)}
						</span>
					</p>
				)}
				{(model.inputPrice !== undefined ||
					model.outputPrice !== undefined ||
					model.requestPrice !== undefined) && (
					<p className="text-xs text-muted-foreground">
						{model.inputPrice !== undefined && (
							<>
								<span className="font-mono text-foreground font-bold">
									${(model.inputPrice * 1e6).toFixed(2)}
								</span>{" "}
								<span className="text-muted-foreground">in</span>
							</>
						)}

						{model.outputPrice !== undefined && (
							<>
								<span className="text-muted-foreground mx-2">/</span>
								<span className="font-mono text-foreground font-bold">
									${(model.outputPrice * 1e6).toFixed(2)}
								</span>{" "}
								<span className="text-muted-foreground">out</span>
							</>
						)}
						{model.requestPrice !== undefined &&
							model.requestPrice !== 0 &&
							` / $${(model.requestPrice * 1000).toFixed(2)} per 1K req`}
					</p>
				)}
			</CardContent>
			<CardFooter className="mt-auto pt-4">
				<Button asChild variant="secondary" className="w-full">
					<Link href={`/models/${encodeURIComponent(model.id)}`}>
						See more details
					</Link>
				</Button>
			</CardFooter>
		</Card>
	);
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

const groupedProviders = modelDefinitions.reduce<
	Record<string, ProviderModel[]>
>((acc, def) => {
	def.providers.forEach((map) => {
		const provider = providerDefinitions.find((p) => p.id === map.providerId)!;
		if (!acc[provider.name]) {
			acc[provider.name] = [];
		}
		acc[provider.name].push({
			id: def.id,
			providerId: map.providerId,
			providerName: provider.name,
			inputPrice: map.inputPrice,
			outputPrice: map.outputPrice,
			requestPrice: map.requestPrice,
			contextSize: map.contextSize,
		});
	});
	return acc;
}, {});

const sortedProviderEntries = Object.entries(groupedProviders)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([providerName, models]) => [providerName, [...models].reverse()]) as [
	string,
	ProviderModel[],
][];

const totalModels = modelDefinitions.length;
const totalProviders = sortedProviderEntries.length;

export const ModelsSupported = ({ isDashboard }: { isDashboard?: boolean }) => {
	const config = useAppConfig();
	const [copiedText, setCopiedText] = useState<string | null>(null);
	const [selectedProvider, setSelectedProvider] = useState<string>("all");

	const copyToClipboard = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedText(text);
			setTimeout(() => setCopiedText(null), 2000);
		} catch (err) {
			console.error("Failed to copy text:", err);
		}
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
										const providerId = models[0].providerId;
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
					const providerId = models[0].providerId;
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
								{models.map((model) => (
									<ProviderModelCard
										key={`${model.providerId}-${model.id}`}
										model={model}
										copiedText={copiedText}
										onCopy={copyToClipboard}
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
