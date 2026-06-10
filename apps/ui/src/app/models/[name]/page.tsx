import {
	Activity,
	AlertTriangle,
	ArrowLeft,
	Zap,
	Eye,
	Wrench,
	MessageSquare,
	ImagePlus,
	Video,
	Boxes,
	Braces,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { adaptModel } from "@/components/models/adapt-model";
import { CopyModelName } from "@/components/models/copy-model-name";
import { DetailProviderCards } from "@/components/models/detail-provider-cards";
import { GlobalDiscountBanner } from "@/components/models/global-discount-banner";
import { ModelBenchmarks } from "@/components/models/model-benchmarks";
import { ModelCtaButton } from "@/components/models/model-cta-button";
import { ModelStatusBadgeAuto } from "@/components/models/model-status-badge-auto";
import { ProviderTabs } from "@/components/models/provider-tabs";
import { Badge } from "@/lib/components/badge";
import {
	applyDiscount,
	getBestDiscount,
	getEffectiveProviderDiscount,
	perMillion,
} from "@/lib/discount";
import { fetchModelDiscounts } from "@/lib/fetch-models";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	expandAllProviderRegions,
	type StabilityLevel,
	type ModelDefinition,
} from "@llmgateway/models";

import type { Metadata } from "next";

interface PageProps {
	params: Promise<{ name: string }>;
}

export const revalidate = 60;

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

	const allDiscounts = await fetchModelDiscounts(decodedName);
	const expandedProviders = expandAllProviderRegions(modelDef.providers);
	const modelProviders = expandedProviders.map((provider) => {
		const providerInfo = providerDefinitions.find(
			(p) => p.id === provider.providerId,
		);
		const globalDiscount = getEffectiveProviderDiscount(
			allDiscounts,
			provider.providerId,
			decodedName,
		);
		return {
			...provider,
			providerInfo,
			discount: globalDiscount,
		};
	});
	const currentModelDiscount = getBestDiscount(allDiscounts, decodedName);

	const adaptedModel = adaptModel(modelDef, modelProviders);

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
		],
	};

	const providerPrices = modelProviders
		.filter((p) => p.inputPrice)
		.map((p) => applyDiscount(perMillion(p.inputPrice)!, p.discount));
	const lowestInputPrice = Math.min(...providerPrices);
	const highestInputPrice = Math.max(...providerPrices);

	const productSchema = {
		"@context": "https://schema.org",
		"@type": "Product",
		name: modelDef.name ?? modelDef.id,
		description:
			modelDef.description ??
			`Access ${modelDef.name ?? modelDef.id} through LLM Gateway's unified API.`,
		brand: {
			"@type": "Brand",
			name: modelDef.family || "LLM Gateway",
		},
		offers: {
			"@type": "AggregateOffer",
			priceCurrency: "USD",
			lowPrice: isFinite(lowestInputPrice) ? lowestInputPrice : 0,
			highPrice: isFinite(highestInputPrice) ? highestInputPrice : 0,
			offerCount: modelProviders.length,
			availability: "https://schema.org/InStock",
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
							href="/models"
							className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
						>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to all models
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
							{Array.isArray(modelDef.output) &&
								modelDef.output.includes("embedding") && (
									<Badge
										variant="outline"
										className="gap-1 text-xs md:text-sm px-2 md:px-3 py-1 border-indigo-500/40 text-indigo-500"
									>
										<Boxes className="h-3.5 w-3.5" />
										Embedding model
									</Badge>
								)}
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
								providers={modelProviders.map((p) => ({
									deprecatedAt: p.deprecatedAt
										? p.deprecatedAt.toISOString()
										: null,
									deactivatedAt: p.deactivatedAt
										? p.deactivatedAt.toISOString()
										: null,
								}))}
							/>

							<ModelCtaButton
								modelId={decodedName}
								output={modelDef.output}
								size="sm"
								className="gap-2"
								iconClassName="h-3 w-3"
							/>

							<Link
								href={`/models/${encodeURIComponent(decodedName)}/uptime`}
								className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-xs md:text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
							>
								<Activity className="h-3.5 w-3.5" />
								View uptime
							</Link>
						</div>

						<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm text-muted-foreground mb-4">
							<div>
								{Math.max(
									...modelProviders.map((p) => p.contextSize ?? 0),
								).toLocaleString()}{" "}
								context
							</div>
							<div>
								Starting at{" "}
								{(() => {
									const inputPrices = modelProviders
										.filter((p) => p.inputPrice)
										.map((p) => ({
											price: applyDiscount(
												perMillion(p.inputPrice)!,
												p.discount,
											),
											originalPrice: perMillion(p.inputPrice)!,
											discount: p.discount,
										}));
									if (inputPrices.length === 0) {
										return "Free";
									}
									const minPrice = Math.min(...inputPrices.map((p) => p.price));
									const minPriceItem = inputPrices.find(
										(p) => p.price === minPrice,
									);
									return Number(minPriceItem?.discount ?? "0") > 0
										? `$${minPrice.toFixed(2)}/M (${(Number(minPriceItem!.discount) * 100).toFixed(0)}% off)`
										: `$${minPrice.toFixed(2)}/M`;
								})()}{" "}
								input tokens
								{modelProviders.some(
									(p) => (p.pricingTiers?.length ?? 0) > 1,
								) && (
									<span className="text-muted-foreground/70"> (tiered)</span>
								)}
							</div>
							<div>
								Starting at{" "}
								{(() => {
									const outputPrices = modelProviders
										.filter((p) => p.outputPrice)
										.map((p) => ({
											price: applyDiscount(
												perMillion(p.outputPrice)!,
												p.discount,
											),
											originalPrice: perMillion(p.outputPrice)!,
											discount: p.discount,
										}));
									if (outputPrices.length === 0) {
										return "Free";
									}
									const minPrice = Math.min(
										...outputPrices.map((p) => p.price),
									);
									const minPriceItem = outputPrices.find(
										(p) => p.price === minPrice,
									);
									return Number(minPriceItem?.discount ?? "0") > 0
										? `$${minPrice.toFixed(2)}/M (${(Number(minPriceItem!.discount) * 100).toFixed(0)}% off)`
										: `$${minPrice.toFixed(2)}/M`;
								})()}{" "}
								output tokens
								{modelProviders.some(
									(p) => (p.pricingTiers?.length ?? 0) > 1,
								) && (
									<span className="text-muted-foreground/70"> (tiered)</span>
								)}
							</div>
							{modelProviders.some((p) => p.imageOutputPrice !== undefined) && (
								<div>
									Starting at{" "}
									{(() => {
										const imageOutputPrices = modelProviders
											.filter((p) => p.imageOutputPrice !== undefined)
											.map((p) => ({
												price: applyDiscount(
													perMillion(p.imageOutputPrice)!,
													p.discount,
												),
												discount:
													p.discount && Number(p.discount) !== 0
														? p.discount
														: undefined,
											}));
										if (imageOutputPrices.length === 0) {
											return "Free";
										}
										const minPrice = Math.min(
											...imageOutputPrices.map((p) => p.price),
										);
										const minPriceItem = imageOutputPrices.find(
											(p) => p.price === minPrice,
										);
										return Number(minPriceItem?.discount ?? "0") > 0
											? `$${minPrice.toFixed(2)}/M (${(Number(minPriceItem!.discount) * 100).toFixed(0)}% off)`
											: `$${minPrice.toFixed(2)}/M`;
									})()}{" "}
									image output tokens
								</div>
							)}
							{modelProviders.some(
								(p) =>
									p.perSecondPrice && Object.keys(p.perSecondPrice).length > 0,
							) && (
								<div>
									Starting at{" "}
									{(() => {
										let minPrice: number | undefined;
										for (const p of modelProviders) {
											if (!p.perSecondPrice) {
												continue;
											}
											for (const v of Object.values(p.perSecondPrice)) {
												const n =
													typeof v === "number" ? v : parseFloat(String(v));
												if (
													Number.isFinite(n) &&
													(minPrice === undefined || n < minPrice)
												) {
													minPrice = n;
												}
											}
										}
										return minPrice !== undefined
											? `$${minPrice}/sec`
											: "Unknown";
									})()}{" "}
									video generation
								</div>
							)}
						</div>

						{/* Capabilities (using same icons as /models) */}
						<div className="flex flex-wrap items-center gap-4 mb-6">
							{(() => {
								const items: Array<{
									key: string;
									icon: any;
									label: string;
									color: string;
								}> = [];
								const hasStreaming = modelProviders.some((p) => p.streaming);
								const hasVision = modelProviders.some((p) => p.vision);
								const hasTools = modelProviders.some((p) => p.tools);
								const hasReasoning = modelProviders.some((p) => p.reasoning);
								const hasJsonOutput = modelProviders.some((p) => p.jsonOutput);
								const hasImageGen = Array.isArray(modelDef.output)
									? modelDef.output.includes("image")
									: false;
								const hasVideoGen = Array.isArray(modelDef.output)
									? modelDef.output.includes("video")
									: false;
								const hasEmbedding = Array.isArray(modelDef.output)
									? modelDef.output.includes("embedding")
									: false;

								if (hasStreaming) {
									items.push({
										key: "streaming",
										icon: Zap,
										label: "Streaming",
										color: "text-blue-500",
									});
								}
								if (hasVision) {
									items.push({
										key: "vision",
										icon: Eye,
										label: "Vision",
										color: "text-green-500",
									});
								}
								if (hasTools) {
									items.push({
										key: "tools",
										icon: Wrench,
										label: "Tools",
										color: "text-purple-500",
									});
								}
								if (hasReasoning) {
									items.push({
										key: "reasoning",
										icon: MessageSquare,
										label: "Reasoning",
										color: "text-orange-500",
									});
								}
								if (hasJsonOutput) {
									items.push({
										key: "jsonOutput",
										icon: Braces,
										label: "JSON Output",
										color: "text-cyan-500",
									});
								}
								if (hasImageGen) {
									items.push({
										key: "image",
										icon: ImagePlus,
										label: "Image Generation",
										color: "text-pink-500",
									});
								}
								if (hasVideoGen) {
									items.push({
										key: "video",
										icon: Video,
										label: "Video Generation",
										color: "text-violet-500",
									});
								}
								if (hasEmbedding) {
									items.push({
										key: "embedding",
										icon: Boxes,
										label: "Embeddings",
										color: "text-indigo-500",
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

					{currentModelDiscount && (
						<div className="mb-6">
							<GlobalDiscountBanner discount={currentModelDiscount} />
						</div>
					)}

					<div className="mb-8">
						<h2 className="text-xl md:text-2xl font-semibold mb-4">
							Select Provider
						</h2>
						<ProviderTabs
							modelId={decodedName}
							providerIds={modelProviders.map((p) => p.providerId)}
							activeProviderId=""
						/>
					</div>

					<div className="mb-8">
						<div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-2">
							<div>
								<h2 className="text-xl md:text-2xl font-semibold mb-2">
									All Providers for {modelDef.name}
								</h2>
								<p className="text-muted-foreground">
									LLM Gateway routes requests to the best providers that are
									able to handle your prompt size and parameters.
								</p>
							</div>
						</div>

						<DetailProviderCards model={adaptedModel} />
					</div>

					<div className="mb-8">
						<ModelBenchmarks modelId={decodedName} />
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

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { name } = await params;
	const decodedName = decodeURIComponent(name);
	const model = modelDefinitions.find((m) => m.id === decodedName) as
		| ModelDefinition
		| undefined;

	if (!model) {
		return {};
	}

	const title = `${model.name ?? model.id} — AI Model Pricing & Capabilities`;
	const description =
		model.description ??
		`Details, pricing, and capabilities for ${model.name ?? model.id} on LLM Gateway.`;

	const primaryProvider = model.providers[0]?.providerId || "default";
	const ogImageUrl = `/models/${encodeURIComponent(decodedName)}/${encodeURIComponent(primaryProvider)}/opengraph-image`;
	const canonical = `https://llmgateway.io/models/${encodeURIComponent(decodedName)}`;

	return {
		title,
		description,
		alternates: {
			canonical,
		},
		openGraph: {
			title,
			description,
			type: "website",
			url: canonical,
			images: [
				{
					url: ogImageUrl,
					width: 1200,
					height: 630,
					alt: `${model.name ?? model.id} model card`,
				},
			],
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
			images: [ogImageUrl],
		},
	};
}
