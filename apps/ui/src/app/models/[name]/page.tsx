import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type StabilityLevel,
	type ModelDefinition,
} from "@llmgateway/models";
import { AlertTriangle } from "lucide-react";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { CopyModelName } from "@/components/models/copy-model-name";
import { ProviderCard } from "@/components/models/provider-card";
import { Badge } from "@/lib/components/badge";

interface PageProps {
	params: Promise<{ name: string }>;
}

export default async function ModelPage({ params }: PageProps) {
	const { name } = await params;
	const decodedName = decodeURIComponent(name);

	const modelDef = modelDefinitions.find(
		(m) => m.id === decodedName,
	) as ModelDefinition;

	if (!modelDef) {
		notFound();
	}

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

	const modelProviders = modelDef.providers.map((provider) => {
		const providerInfo = providerDefinitions.find(
			(p) => p.id === provider.providerId,
		);
		return {
			...provider,
			providerInfo,
		};
	});

	return (
		<>
			<Navbar />
			<div className="min-h-screen bg-background py-32">
				<div className="container mx-auto px-4 py-8">
					<div className="mb-8">
						<div className="flex items-center gap-3 mb-2">
							<h1 className="text-4xl font-bold tracking-tight">
								{modelDef.id}
							</h1>
							{shouldShowStabilityWarning(modelDef.stability) && (
								<AlertTriangle className="h-8 w-8 text-orange-500" />
							)}
						</div>
						<div className="flex items-center gap-2 mb-4">
							<CopyModelName modelName={decodedName} />
							{(() => {
								const stabilityProps = getStabilityBadgeProps(
									modelDef.stability,
								);
								return stabilityProps ? (
									<Badge
										variant={stabilityProps.variant}
										className="text-sm px-3 py-1"
									>
										{stabilityProps.label}
									</Badge>
								) : (
									<Badge variant="outline" className="text-sm px-3 py-1">
										STABLE
									</Badge>
								);
							})()}
						</div>

						<div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-4">
							<span>
								{Math.max(
									...modelProviders.map((p) => p.contextSize || 0),
								).toLocaleString()}{" "}
								context
							</span>
							<span>
								Starting at $
								{(() => {
									const inputPrices = modelProviders
										.filter((p) => p.inputPrice)
										.map((p) => (p.inputPrice! * 1e6).toFixed(2))
										.map(Number);
									return inputPrices.length > 0
										? Math.min(...inputPrices)
										: "N/A";
								})()}
								/M input tokens
							</span>
							<span>
								Starting at $
								{(() => {
									const outputPrices = modelProviders
										.filter((p) => p.outputPrice)
										.map((p) => (p.outputPrice! * 1e6).toFixed(2))
										.map(Number);
									return outputPrices.length > 0
										? Math.min(...outputPrices)
										: "N/A";
								})()}
								/M output tokens
							</span>
						</div>

						<p className="text-muted-foreground max-w-4xl">
							{modelDef.id} is available across multiple providers with
							different configurations, pricing, and performance
							characteristics. Choose the provider that best fits your needs.
						</p>
						{shouldShowStabilityWarning(modelDef.stability) && (
							<div className="mt-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
								<div className="flex items-start gap-3">
									<AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5 flex-shrink-0" />
									<div>
										<h3 className="font-medium text-orange-800 mb-1">
											{modelDef.stability === "experimental"
												? "Experimental"
												: "Unstable"}{" "}
											Model Warning
										</h3>
										<p className="text-sm text-orange-700">
											This model is marked as {modelDef.stability} and may have
											issues with reliability, performance, or consistency. Use
											with caution in production environments.
										</p>
									</div>
								</div>
							</div>
						)}
					</div>

					<div className="mb-8">
						<div className="flex items-center justify-between mb-6">
							<div>
								<h2 className="text-2xl font-semibold mb-2">
									Providers for {modelDef.id}
								</h2>
								<p className="text-muted-foreground">
									LLM Gateway routes requests to the best providers that are
									able to handle your prompt size and parameters, with fallbacks
									to maximize uptime.
								</p>
							</div>
						</div>

						<div className="space-y-4">
							{modelProviders.map((provider) => (
								<ProviderCard
									key={provider.providerId}
									provider={provider}
									modelName={decodedName}
									modelStability={modelDef.stability}
								/>
							))}
						</div>
					</div>
				</div>
			</div>
			<Footer />
		</>
	);
}

export async function generateStaticParams() {
	return modelDefinitions.map((model) => ({
		name: encodeURIComponent(model.id),
	}));
}

export async function generateMetadata({ params }: PageProps) {
	const { name } = await params;
	const decodedName = decodeURIComponent(name);
	const model = modelDefinitions.find((m) => m.id === decodedName);

	if (!model) {
		return {};
	}

	return {
		title: `${model.id} - LLM Gateway`,
		description: `Explore ${model.id} across providers on LLM Gateway.`,
		openGraph: {
			title: `${model.id} - LLM Gateway`,
			description: `Explore ${model.id} across providers on LLM Gateway.`,
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: `${model.id} - LLM Gateway`,
			description: `Explore ${model.id} across providers.`,
		},
	};
}
