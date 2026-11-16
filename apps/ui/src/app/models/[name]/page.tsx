import {
	Activity,
	AlertTriangle,
	ArrowLeft,
	Zap,
	Eye,
	FileJson2,
	Wrench,
	MessageSquare,
	Sliders,
	SlidersHorizontal,
	ImagePlus,
	Video,
	Boxes,
	Braces,
	Volume2,
	Mic,
	ListOrdered,
	Globe,
	Layers,
	Search,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { adaptModel } from "@/components/models/adapt-model";
import { CopyModelName } from "@/components/models/copy-model-name";
import { GlobalDiscountBanner } from "@/components/models/global-discount-banner";
import { ModelBenchmarks } from "@/components/models/model-benchmarks";
import {
	ModelCtaButton,
	TryInLoungeLink,
} from "@/components/models/model-cta-button";
import { ModelFaqSection } from "@/components/models/model-faq";
import { ModelRating } from "@/components/models/model-rating";
import { ModelStatusBadgeAuto } from "@/components/models/model-status-badge-auto";
import { ModelUsageStats } from "@/components/models/model-usage-stats";
import { ProviderComparisonTable } from "@/components/models/provider-comparison-table";
import { RelatedModels } from "@/components/models/related-models";
import { VirtualModelBanner } from "@/components/models/virtual-model-banner";
import { JsonLd } from "@/components/seo/json-ld";
import { findPublicModelDefinition } from "@/lib/airside-model-fallback";
import { Badge } from "@/lib/components/badge";
import {
	applyDiscount,
	getBestDiscount,
	getEffectiveProviderDiscount,
	perMillion,
} from "@/lib/discount";
import { fetchModelDiscounts, fetchProviders } from "@/lib/fetch-models";
import { buildFaqSchema, buildModelFaqs } from "@/lib/model-faq";
import { getCheapestOgMapping } from "@/lib/model-og";
import { isLoungeChatModel } from "@/lib/model-utils";
import { pageTitle } from "@/lib/page-title";
import { buildRatingSchema, type ModelRatingsData } from "@/lib/rating-schema";
import { fetchServerData } from "@/lib/server-api";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	expandAllProviderRegions,
	getBatchEndpoints,
	type StabilityLevel,
	getVirtualModelTarget,
} from "@llmgateway/models";
import {
	BATCH_DOCS_URL,
	batchSupportDescription,
	formatPerUnitPrice,
	getMinPerSecondPrice,
	isMappingDeactivated,
} from "@llmgateway/shared/components";
import { formatNumber } from "@llmgateway/shared/number-format";

import type { Metadata } from "next";

interface PageProps {
	params: Promise<{ name: string }>;
}

export const revalidate = 60;

export default async function ModelPage({ params }: PageProps) {
	const { name } = await params;
	const decodedName = decodeURIComponent(name);
	const canonicalName = getVirtualModelTarget(decodedName)?.id ?? decodedName;

	// Fetchers resolve to fallbacks, so an early notFound can leave them pending.
	const modelDefPromise = findPublicModelDefinition(decodedName);
	const pageDataPromise = Promise.all([
		fetchModelDiscounts(canonicalName),
		fetchServerData<ModelRatingsData>("GET", "/public/model-ratings", {
			params: { query: { modelId: canonicalName } },
		}),
		fetchProviders(),
	]);
	const modelDef = await modelDefPromise;

	if (!modelDef) {
		notFound();
	}

	const [allDiscounts, ratingsData, apiProviders] = await pageDataPromise;

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

	// Carrier-uploaded branding (Airside claims) overlays the static provider
	// info, and is the only provider info a DB-only carrier has.
	const expandedProviders = expandAllProviderRegions(modelDef.providers);
	const modelProviders = expandedProviders.map((provider) => {
		const providerInfo = providerDefinitions.find(
			(p) => p.id === provider.providerId,
		);
		const apiProvider = apiProviders.find((p) => p.id === provider.providerId);
		const globalDiscount = getEffectiveProviderDiscount(
			allDiscounts,
			provider.providerId,
			canonicalName,
		);
		const baseInfo = providerInfo ?? apiProvider;
		return {
			...provider,
			// Downstream consumers only read display fields, so the merged
			// object stays typed as the static definition.
			providerInfo: baseInfo
				? ({
						...baseInfo,
						airsideLogoUrl: apiProvider?.airsideLogoUrl ?? null,
						airsideIconUrl: apiProvider?.airsideIconUrl ?? null,
					} as unknown as NonNullable<typeof providerInfo>)
				: undefined,
			discount: globalDiscount,
		};
	});
	// Square carrier marks for compact rows; wordmarks only as a fallback.
	const uploadedProviderIcons = Object.fromEntries(
		apiProviders
			.map((p) => [p.id, p.airsideIconUrl ?? p.airsideLogoUrl])
			.filter((entry): entry is [string, string] => Boolean(entry[1])),
	);
	// Aggregated metrics (pricing, context, capabilities) describe what can
	// actually be routed today, so deactivated providers are excluded. Models
	// whose providers are all deactivated fall back to showing everything.
	const activeProviders = modelProviders.filter(
		(p) => !isMappingDeactivated(p),
	);
	const visibleProviders =
		activeProviders.length > 0 ? activeProviders : modelProviders;
	// Search models bill per request only, so token and context stats are noise.
	const isSearchModel = modelDef.output?.includes("search") ?? false;
	// OCR models bill per page; their zero token prices would read as "free".
	const isOcrModel =
		(modelDef.output?.includes("ocr") ?? false) ||
		visibleProviders.some((p) => Number(p.ocrPagePrice ?? 0) > 0);
	const hideTokenInfo = isSearchModel || isOcrModel;

	const currentModelDiscount = getBestDiscount(
		allDiscounts,
		canonicalName,
		Array.from(new Set(activeProviders.map((p) => p.providerId))),
	);
	const currentModelDiscountProvider = currentModelDiscount?.provider
		? (providerDefinitions.find((p) => p.id === currentModelDiscount.provider)
				?.name ?? currentModelDiscount.provider)
		: null;

	const adaptedModel = adaptModel(modelDef, modelProviders);

	const faqs = buildModelFaqs(modelDef, visibleProviders);
	const faqSchema = buildFaqSchema(faqs);

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

	const providerPrices = visibleProviders
		.filter((p) => (isOcrModel ? p.ocrPagePrice : p.inputPrice))
		.map((p) =>
			applyDiscount(
				isOcrModel ? Number(p.ocrPagePrice) : perMillion(p.inputPrice)!,
				p.discount,
			),
		);
	const lowestInputPrice = Math.min(...providerPrices);
	const highestInputPrice = Math.max(...providerPrices);

	const primaryProviderId =
		getCheapestOgMapping(modelDef, allDiscounts)?.providerId ?? "default";
	const productSchema = {
		"@context": "https://schema.org",
		"@type": "Product",
		name: modelDef.name ?? modelDef.id,
		description:
			modelDef.description ??
			`Access ${modelDef.name ?? modelDef.id} through LLM Gateway's unified API.`,
		image: `https://llmgateway.io/models/${encodeURIComponent(decodedName)}/${encodeURIComponent(primaryProviderId)}/opengraph-image`,
		brand: {
			"@type": "Brand",
			name: modelDef.family || "LLM Gateway",
		},
		offers: {
			"@type": "AggregateOffer",
			priceCurrency: "USD",
			lowPrice: isFinite(lowestInputPrice) ? lowestInputPrice : 0,
			highPrice: isFinite(highestInputPrice) ? highestInputPrice : 0,
			offerCount: visibleProviders.length,
			...(isOcrModel && isFinite(lowestInputPrice)
				? {
						priceSpecification: {
							"@type": "UnitPriceSpecification",
							price: lowestInputPrice,
							priceCurrency: "USD",
							unitText: "per page",
						},
					}
				: {}),
			availability: "https://schema.org/InStock",
			url: `https://llmgateway.io/models/${encodeURIComponent(decodedName)}`,
		},
		category: "AI/ML API Service",
		...buildRatingSchema(ratingsData),
	};

	const capabilityItems = (() => {
		const items: Array<{
			key: string;
			icon: any;
			label: string;
			color: string;
			href?: string;
			title?: string;
		}> = [];
		const hasStreaming = visibleProviders.some((p) => p.streaming);
		const hasVision = visibleProviders.some((p) => p.vision);
		const hasTools = visibleProviders.some((p) => p.tools);
		const hasReasoning = visibleProviders.some((p) => p.reasoning);
		const hasReasoningMaxTokens = visibleProviders.some(
			(p) => p.reasoningMaxTokens,
		);
		const hasJsonOutput = visibleProviders.some((p) => p.jsonOutput);
		const hasJsonOutputSchema = visibleProviders.some(
			(p) => p.jsonOutputSchema,
		);
		const hasWebSearch = visibleProviders.some((p) => p.webSearch);
		const hasImageGen = Array.isArray(modelDef.output)
			? modelDef.output.includes("image")
			: false;
		const hasVideoGen = Array.isArray(modelDef.output)
			? modelDef.output.includes("video")
			: false;
		const hasEmbedding = Array.isArray(modelDef.output)
			? modelDef.output.includes("embedding")
			: false;
		const hasRerank = Array.isArray(modelDef.output)
			? modelDef.output.includes("rerank")
			: false;
		const hasSearch = Array.isArray(modelDef.output)
			? modelDef.output.includes("search")
			: false;
		const hasAudio = Array.isArray(modelDef.output)
			? modelDef.output.includes("audio")
			: false;
		const hasTranscription = Array.isArray(modelDef.output)
			? modelDef.output.includes("transcription")
			: false;
		const hasDecision = Array.isArray(modelDef.output)
			? modelDef.output.includes("decision")
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
		if (hasReasoningMaxTokens) {
			items.push({
				key: "reasoningMaxTokens",
				icon: Sliders,
				label: "Reasoning Budget",
				color: "text-amber-500",
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
		if (hasJsonOutputSchema) {
			items.push({
				key: "jsonOutputSchema",
				icon: FileJson2,
				label: "Structured JSON",
				color: "text-teal-500",
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
		if (hasAudio) {
			items.push({
				key: "audio",
				icon: Volume2,
				label: "Speech Generation",
				color: "text-rose-500",
			});
		}
		if (hasTranscription) {
			items.push({
				key: "transcription",
				icon: Mic,
				label: "Transcription",
				color: "text-sky-500",
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
		if (hasRerank) {
			items.push({
				key: "rerank",
				icon: ListOrdered,
				label: "Rerank",
				color: "text-amber-500",
			});
		}
		if (hasDecision) {
			items.push({
				key: "decision",
				icon: SlidersHorizontal,
				label: "Decisions",
				color: "text-teal-500",
			});
		}
		if (hasSearch) {
			items.push({
				key: "search",
				icon: Search,
				label: "Search API",
				color: "text-sky-500",
			});
		}
		if (hasWebSearch) {
			items.push({
				key: "webSearch",
				icon: Globe,
				label: "Web Search",
				color: "text-sky-500",
			});
		}
		const batchEndpoints = Array.from(
			new Set(visibleProviders.flatMap((p) => getBatchEndpoints(p, modelDef))),
		);
		if (batchEndpoints.length > 0) {
			items.push({
				key: "batch",
				icon: Layers,
				label: "Batch API",
				color: "text-fuchsia-500",
				href: BATCH_DOCS_URL,
				title: batchSupportDescription(batchEndpoints),
			});
		}
		return items;
	})();

	const uniqueProviderCount = new Set(visibleProviders.map((p) => p.providerId))
		.size;
	const isTiered = visibleProviders.some(
		(p) => (p.pricingTiers?.length ?? 0) > 1,
	);
	const cheapestTokenPrice = (
		field: "inputPrice" | "outputPrice" | "imageOutputPrice",
	) => {
		const prices = visibleProviders
			.filter((p) => p[field] !== undefined)
			.map((p) => ({
				price: applyDiscount(perMillion(p[field])!, p.discount),
				discount: Number(p.discount ?? "0"),
			}))
			.sort((a, b) => a.price - b.price);
		const cheapest = prices[0];
		if (!cheapest) {
			return null;
		}
		return {
			value: `$${cheapest.price.toFixed(2)}`,
			hint: [
				"per 1M tokens",
				cheapest.discount > 0 && `${(cheapest.discount * 100).toFixed(0)}% off`,
				field !== "imageOutputPrice" && isTiered && "tiered",
			]
				.filter(Boolean)
				.join(" · "),
		};
	};
	const imageOutput = cheapestTokenPrice("imageOutputPrice");
	const facts: Array<{ label: string; value: string; hint?: string }> = [];
	if (!hideTokenInfo) {
		const maxContext = Math.max(
			...visibleProviders.map((p) => p.contextSize ?? 0),
		);
		if (maxContext > 0) {
			facts.push({
				label: "Context",
				value: formatNumber(maxContext),
				hint: "tokens",
			});
		}
		const maxOutput = Math.max(
			...visibleProviders.map((p) => p.maxOutput ?? 0),
		);
		if (maxOutput > 0) {
			facts.push({
				label: "Max output",
				value: formatNumber(maxOutput),
				hint: "tokens",
			});
		}
		const input = visibleProviders.some((p) => p.inputPrice)
			? cheapestTokenPrice("inputPrice")
			: null;
		if (input) {
			facts.push({ label: "Input from", ...input });
		}
		const output = visibleProviders.some((p) => p.outputPrice)
			? cheapestTokenPrice("outputPrice")
			: null;
		if (output && (output.value !== "$0.00" || !imageOutput)) {
			facts.push({ label: "Output from", ...output });
		}
	}
	if (imageOutput) {
		facts.push({ label: "Image output from", ...imageOutput });
	}
	const perSecondPrices = visibleProviders
		.map((p) => getMinPerSecondPrice(p))
		.filter((v): v is number => v !== null);
	if (perSecondPrices.length > 0) {
		facts.push({
			label: "Video from",
			value: formatPerUnitPrice(Math.min(...perSecondPrices)),
			hint: "per second",
		});
	}
	const perImagePrices = visibleProviders.flatMap((p) =>
		Object.values(p.perImagePrice ?? {})
			.map((v) => (typeof v === "number" ? v : parseFloat(String(v))))
			.filter((raw) => Number.isFinite(raw))
			.map((raw) => applyDiscount(raw, p.discount)),
	);
	if (perImagePrices.length > 0) {
		facts.push({
			label: "Image from",
			value: `$${parseFloat(Math.min(...perImagePrices).toFixed(4))}`,
			hint: "per image",
		});
	}
	if (isSearchModel) {
		facts.push({
			label: "Search from",
			value: `$${(
				Math.min(
					...visibleProviders.map((p) =>
						applyDiscount(Number(p.requestPrice ?? 0), p.discount),
					),
				) * 1000
			).toFixed(2)}`,
			hint: "per 1,000 searches",
		});
	}
	const ocrPagePrices = visibleProviders
		.filter((p) => p.ocrPagePrice !== undefined)
		.map((p) => applyDiscount(Number(p.ocrPagePrice), p.discount))
		.filter((n) => Number.isFinite(n));
	if (ocrPagePrices.length > 0) {
		facts.push({
			label: "OCR from",
			value: `$${(Math.min(...ocrPagePrices) * 1000).toFixed(2)}`,
			hint: "per 1,000 pages",
		});
	}
	facts.push({
		label: "Providers",
		value: String(uniqueProviderCount),
		hint: uniqueProviderCount === 1 ? "one route" : "automatic routing",
	});
	if (modelDef.releasedAt) {
		facts.push({
			label: "Released",
			value: modelDef.releasedAt.toLocaleDateString("en-US", {
				year: "numeric",
				month: "short",
				day: "numeric",
				timeZone: "UTC",
			}),
		});
	}
	const stabilityBadge = getStabilityBadgeProps(modelDef.stability);
	const pageSections = [
		{ href: "#providers", label: `Providers (${uniqueProviderCount})` },
		{ href: "#performance", label: "Performance" },
		...(faqs.length > 0 ? [{ href: "#faq", label: "FAQ" }] : []),
		{ href: "#related", label: "Related models" },
	];
	const secondaryActionClass =
		"inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground";

	return (
		<>
			<JsonLd data={[breadcrumbSchema, productSchema, faqSchema]} />
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
					<VirtualModelBanner
						target={modelDef.virtualModelTarget}
						providers={modelDef.providers}
						discounts={allDiscounts}
					/>
					<header className="mb-8">
						<div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
							<div className="min-w-0 max-w-3xl">
								<div className="flex flex-wrap items-center gap-3">
									<h1 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">
										{modelDef.name}
									</h1>
									{shouldShowStabilityWarning(modelDef.stability) && (
										<AlertTriangle className="h-6 w-6 text-orange-500" />
									)}
									{stabilityBadge && (
										<Badge variant={stabilityBadge.variant}>
											{stabilityBadge.label}
										</Badge>
									)}
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
								</div>
								{modelDef.description && (
									<p className="mt-3 text-muted-foreground text-pretty">
										{modelDef.description}
									</p>
								)}
								<div className="mt-4 flex flex-wrap items-center gap-2">
									<CopyModelName modelName={decodedName} />
									<ModelUsageStats modelId={canonicalName} />
								</div>
							</div>
							<div className="flex shrink-0 flex-wrap items-center gap-2">
								<ModelCtaButton
									modelId={canonicalName}
									output={modelDef.output}
									size="sm"
									className="gap-2"
									iconClassName="h-3 w-3"
									location="model_page"
								/>
								{isLoungeChatModel(modelDef, activeProviders) && (
									<TryInLoungeLink
										modelId={canonicalName}
										location="model_page"
										className={secondaryActionClass}
									/>
								)}
								<Link
									href={`/models/${encodeURIComponent(decodedName)}/uptime`}
									className={secondaryActionClass}
								>
									<Activity className="h-3.5 w-3.5" />
									Live uptime
								</Link>
							</div>
						</div>

						<dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
							{facts.map((fact) => (
								<div
									key={fact.label}
									className="rounded-lg border bg-card px-4 py-3"
								>
									<dt className="text-xs text-muted-foreground">
										{fact.label}
									</dt>
									<dd className="mt-1 text-lg font-semibold tabular-nums leading-tight">
										{fact.value}
									</dd>
									{fact.hint && (
										<dd className="mt-0.5 text-xs text-muted-foreground">
											{fact.hint}
										</dd>
									)}
								</div>
							))}
						</dl>

						<ul className="mt-4 flex flex-wrap gap-2">
							{capabilityItems.map(
								({ key, icon: Icon, label, color, href, title }) => (
									<li key={key}>
										{href ? (
											<a
												href={href}
												target="_blank"
												rel="noopener noreferrer"
												title={title}
												className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
											>
												<Icon className={`h-3.5 w-3.5 ${color}`} />
												{label}
											</a>
										) : (
											<span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
												<Icon className={`h-3.5 w-3.5 ${color}`} />
												{label}
											</span>
										)}
									</li>
								),
							)}
						</ul>

						<div className="mt-4">
							<ModelRating
								modelId={canonicalName}
								initialData={ratingsData ?? undefined}
							/>
						</div>
					</header>

					{currentModelDiscount && (
						<div className="mb-6">
							<GlobalDiscountBanner
								discount={currentModelDiscount}
								providerName={currentModelDiscountProvider}
							/>
						</div>
					)}

					<nav
						aria-label="On this page"
						className="mb-8 flex gap-1 overflow-x-auto border-b"
					>
						{pageSections.map((section) => (
							<a
								key={section.href}
								href={section.href}
								className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
							>
								{section.label}
							</a>
						))}
					</nav>

					<section id="providers" className="mb-12 scroll-mt-28">
						<h2 className="text-xl font-semibold md:text-2xl">
							Providers for {modelDef.name}
						</h2>
						<p className="mb-4 mt-1 max-w-3xl text-muted-foreground">
							Compare price, limits and live performance side by side. LLM
							Gateway routes each request to the best provider that can handle
							your prompt size and parameters.
						</p>
						<ProviderComparisonTable model={adaptedModel} />
					</section>

					<section id="performance" className="mb-12 scroll-mt-28">
						<ModelBenchmarks
							modelId={canonicalName}
							uploadedIcons={uploadedProviderIcons}
						/>
					</section>

					<section id="faq" className="mb-12 scroll-mt-28">
						<ModelFaqSection faqs={faqs} />
					</section>

					<section id="related" className="mb-8 scroll-mt-28">
						<RelatedModels modelDef={modelDef} />
					</section>
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
	const [model, discounts] = await Promise.all([
		findPublicModelDefinition(decodedName),
		fetchModelDiscounts(decodedName),
	]);

	if (!model) {
		return {};
	}

	const title = `${model.name ?? model.id} — Pricing, Providers & Benchmarks`;
	const pitch = `Use ${model.name ?? model.id} via one OpenAI-compatible API with live per-token pricing across providers.`;
	const shortPitch = "Live per-token pricing across providers via one API.";
	const description = !model.description
		? pitch
		: ([pitch, shortPitch]
				.map((suffix) => `${model.description} ${suffix}`)
				.find((candidate) => candidate.length <= 160) ?? model.description);

	const primaryProvider =
		getCheapestOgMapping(model, discounts)?.providerId ?? "default";
	const ogImageUrl = `/models/${encodeURIComponent(decodedName)}/${encodeURIComponent(primaryProvider)}/opengraph-image`;
	const canonical = `https://llmgateway.io/models/${encodeURIComponent(decodedName)}`;

	return {
		title: pageTitle(title),
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
