import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	Zap,
	Eye,
	Wrench,
	MessageSquare,
	ImagePlus,
	Braces,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { adaptModel } from "@/components/models/adapt-model";
import { CopyModelName } from "@/components/models/copy-model-name";
import { DetailProviderCards } from "@/components/models/detail-provider-cards";
import {
	GlobalDiscountBanner,
	type DiscountData,
} from "@/components/models/global-discount-banner";
import { ModelStatusBadgeAuto } from "@/components/models/model-status-badge-auto";
import { ProviderTabs } from "@/components/models/provider-tabs";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { getConfig } from "@/lib/config-server";
import { fetchServerData } from "@/lib/server-api";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	expandAllProviderRegions,
	type StabilityLevel,
	type ModelDefinition,
} from "@llmgateway/models";

import type { Metadata } from "next";

interface PageProps {
	params: Promise<{ name: string; provider: string }>;
}

export default async function ModelProviderPage({ params }: PageProps) {
	const config = getConfig();
	const { name, provider } = await params;
	const decodedName = decodeURIComponent(name);
	const decodedProvider = decodeURIComponent(provider);

	const modelDef = modelDefinitions.find(
		(m) => m.id === decodedName,
	) as ModelDefinition;

	if (!modelDef) {
		notFound();
	}

	// Get ALL mappings for this provider (including regional variants)
	const expandedProviders = expandAllProviderRegions(modelDef.providers);
	const providerMappings = expandedProviders.filter(
		(p) => p.providerId === decodedProvider,
	);

	if (providerMappings.length === 0) {
		notFound();
	}

	const staticProviderMapping = providerMappings[0];

	const providerInfo = providerDefinitions.find(
		(p) => p.id === decodedProvider,
	);

	// Fetch global discounts and apply to provider
	const discountData = await fetchServerData<{ discounts: DiscountData[] }>(
		"GET",
		"/public/discounts/model/{modelId}",
		{ params: { path: { modelId: decodedName } } },
	);
	const discounts = discountData?.discounts ?? [];
	const globalDiscount = (() => {
		const providerModel = discounts.find(
			(d) => d.provider === decodedProvider && d.model === decodedName,
		);
		if (providerModel) {
			return parseFloat(providerModel.discountPercent);
		}
		const providerOnly = discounts.find(
			(d) => d.provider === decodedProvider && d.model === null,
		);
		if (providerOnly) {
			return parseFloat(providerOnly.discountPercent);
		}
		const modelOnly = discounts.find(
			(d) => d.provider === null && d.model === decodedName,
		);
		if (modelOnly) {
			return parseFloat(modelOnly.discountPercent);
		}
		const fullyGlobal = discounts.find(
			(d) => d.provider === null && d.model === null,
		);
		if (fullyGlobal) {
			return parseFloat(fullyGlobal.discountPercent);
		}
		return undefined;
	})();

	const providerMapping = {
		...staticProviderMapping,
		discount: globalDiscount ?? staticProviderMapping.discount,
	};

	const bannerDiscount: DiscountData | null = (() => {
		const providerModel = discounts.find(
			(d) => d.provider === decodedProvider && d.model === decodedName,
		);
		if (providerModel) {
			return providerModel;
		}
		const providerOnly = discounts.find(
			(d) => d.provider === decodedProvider && d.model === null,
		);
		if (providerOnly) {
			return providerOnly;
		}
		const modelOnly = discounts.find(
			(d) => d.provider === null && d.model === decodedName,
		);
		if (modelOnly) {
			return modelOnly;
		}
		const fullyGlobal = discounts.find(
			(d) => d.provider === null && d.model === null,
		);
		if (fullyGlobal) {
			return fullyGlobal;
		}
		return null;
	})();

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

	const allProviderIds = modelDef.providers.map((p) => p.providerId);

	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{
				"@type": "ListItem",
				position: 1,
				name: "Home",
				item: "https://llmgateway.io",
			},
			{
				"@type": "ListItem",
				position: 2,
				name: "Models",
				item: "https://llmgateway.io/models",
			},
			{
				"@type": "ListItem",
				position: 3,
				name: modelDef.name ?? modelDef.id,
				item: `https://llmgateway.io/models/${encodeURIComponent(decodedName)}`,
			},
			{
				"@type": "ListItem",
				position: 4,
				name: providerInfo?.name ?? decodedProvider,
				item: `https://llmgateway.io/models/${encodeURIComponent(decodedName)}/${encodeURIComponent(decodedProvider)}`,
			},
		],
	};

	const productSchema = {
		"@context": "https://schema.org",
		"@type": "Product",
		name: `${modelDef.name ?? modelDef.id} on ${providerInfo?.name ?? decodedProvider}`,
		description:
			modelDef.description ??
			`Access ${modelDef.name ?? modelDef.id} via ${providerInfo?.name ?? decodedProvider} through LLM Gateway's unified API.`,
		brand: {
			"@type": "Brand",
			name: providerInfo?.name ?? decodedProvider,
		},
		offers: {
			"@type": "Offer",
			priceCurrency: "USD",
			price: providerMapping.inputPrice ?? 0,
			priceSpecification: {
				"@type": "UnitPriceSpecification",
				price: providerMapping.inputPrice ?? 0,
				priceCurrency: "USD",
				unitText: "per 1M input tokens",
			},
			availability: "https://schema.org/InStock",
			seller: {
				"@type": "Organization",
				name: "LLM Gateway",
			},
		},
		category: "AI/ML API Service",
	};

	return (
		<>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(breadcrumbSchema),
				}}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(productSchema),
				}}
			/>
			<Navbar />
			<div className="min-h-screen bg-background pt-24 md:pt-32 pb-16">
				<div className="container mx-auto px-4 py-8">
					<div className="mb-6">
						<Link
							href={`/models/${encodeURIComponent(decodedName)}`}
							className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
						>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to {modelDef.name}
						</Link>
					</div>
					<div className="mb-8">
						<div className="flex items-center gap-3 mb-2 flex-wrap">
							<h1 className="text-3xl md:text-4xl font-bold tracking-tight">
								{modelDef.name}
							</h1>
							{shouldShowStabilityWarning(modelDef.stability) && (
								<AlertTriangle className="h-6 w-6 md:h-8 md:w-8 text-orange-500" />
							)}
						</div>
						{modelDef.description && (
							<p className="text-muted-foreground mb-4">
								{modelDef.description}
							</p>
						)}
						<div className="flex flex-wrap items-center gap-2 md:gap-3 mb-4">
							<CopyModelName modelName={decodedName} />
							{(() => {
								const stabilityProps = getStabilityBadgeProps(
									modelDef.stability,
								);
								return stabilityProps ? (
									<Badge
										variant={stabilityProps.variant}
										className="text-xs md:text-sm px-2 md:px-3 py-1"
									>
										{stabilityProps.label}
									</Badge>
								) : (
									<Badge
										variant="outline"
										className="text-xs md:text-sm px-2 md:px-3 py-1"
									>
										STABLE
									</Badge>
								);
							})()}
							<ModelStatusBadgeAuto
								providers={[
									{
										deprecatedAt: providerMapping.deprecatedAt
											? providerMapping.deprecatedAt.toISOString()
											: null,
										deactivatedAt: providerMapping.deactivatedAt
											? providerMapping.deactivatedAt.toISOString()
											: null,
									},
								]}
							/>

							<Button variant="default" size="sm" className="gap-2" asChild>
								<a href={`${config.appUrl}/signup`}>
									Get Started
									<ArrowRight className="h-3 w-3" />
								</a>
							</Button>
						</div>

						{/* Capabilities */}
						<div className="flex flex-wrap items-center gap-4 mb-6">
							{(() => {
								const items: Array<{
									key: string;
									icon: typeof Zap;
									label: string;
									color: string;
								}> = [];

								if (providerMapping.streaming) {
									items.push({
										key: "streaming",
										icon: Zap,
										label: "Streaming",
										color: "text-blue-500",
									});
								}
								if (providerMapping.vision) {
									items.push({
										key: "vision",
										icon: Eye,
										label: "Vision",
										color: "text-green-500",
									});
								}
								if (providerMapping.tools) {
									items.push({
										key: "tools",
										icon: Wrench,
										label: "Tools",
										color: "text-purple-500",
									});
								}
								if (providerMapping.reasoning) {
									items.push({
										key: "reasoning",
										icon: MessageSquare,
										label: "Reasoning",
										color: "text-orange-500",
									});
								}
								if (providerMapping.jsonOutput) {
									items.push({
										key: "jsonOutput",
										icon: Braces,
										label: "JSON Output",
										color: "text-cyan-500",
									});
								}
								const hasImageGen = Array.isArray(modelDef.output)
									? modelDef.output.includes("image")
									: false;
								if (hasImageGen) {
									items.push({
										key: "image",
										icon: ImagePlus,
										label: "Image Generation",
										color: "text-pink-500",
									});
								}

								return items.map(({ key, icon: Icon, label, color }) => (
									<div
										key={key}
										className="inline-flex items-center gap-2 text-sm text-foreground"
									>
										<Icon className={`h-4 w-4 ${color}`} />
										<span className="text-muted-foreground">{label}</span>
									</div>
								));
							})()}
						</div>
					</div>

					{bannerDiscount && (
						<div className="mb-6">
							<GlobalDiscountBanner discount={bannerDiscount} />
						</div>
					)}

					<div className="mb-8">
						<h2 className="text-xl md:text-2xl font-semibold mb-4">
							Select Provider
						</h2>
						<ProviderTabs
							modelId={decodedName}
							providerIds={allProviderIds}
							activeProviderId={decodedProvider}
						/>
					</div>

					<div className="mb-8">
						<div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-2">
							<div>
								<h2 className="text-xl md:text-2xl font-semibold mb-2">
									{providerInfo?.name ?? decodedProvider} Pricing for{" "}
									{modelDef.name}
								</h2>
								<p className="text-muted-foreground">
									View detailed pricing and capabilities for this provider.
								</p>
							</div>
						</div>

						<DetailProviderCards
							model={adaptModel(
								modelDef,
								providerMappings.map((p) => ({
									...p,
									providerInfo,
									discount: globalDiscount ?? p.discount,
								})),
							)}
						/>
					</div>
				</div>
			</div>
			<Footer />
		</>
	);
}

export async function generateStaticParams() {
	const params: { name: string; provider: string }[] = [];

	for (const model of modelDefinitions) {
		const uniqueProviders = Array.from(
			new Set(model.providers.map((p) => p.providerId)),
		);
		for (const providerId of uniqueProviders) {
			params.push({
				name: encodeURIComponent(model.id),
				provider: encodeURIComponent(providerId),
			});
		}
	}

	return params;
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { name, provider } = await params;
	const decodedName = decodeURIComponent(name);
	const decodedProvider = decodeURIComponent(provider);

	const model = modelDefinitions.find((m) => m.id === decodedName) as
		| ModelDefinition
		| undefined;

	if (!model) {
		return {};
	}

	const providerInfo = providerDefinitions.find(
		(p) => p.id === decodedProvider,
	);
	const providerName = providerInfo?.name ?? decodedProvider;

	const title = `${model.name ?? model.id} on ${providerName} – LLM Gateway`;
	const description = `Pricing and capabilities for ${model.name ?? model.id} via ${providerName} on LLM Gateway.`;

	return {
		title,
		description,
		openGraph: {
			title,
			description,
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}
