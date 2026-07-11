import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/providers/hero";
import { ProviderModelsGrid } from "@/components/providers/provider-models-grid";
import { JsonLd } from "@/components/seo/json-ld";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "@/lib/fetch-models";
import type { Metadata } from "next";

interface ModelWithProviders extends ApiModel {
	providerDetails: Array<{
		provider: ApiModelProviderMapping;
		providerInfo: ApiProvider;
	}>;
}

interface ProviderPageProps {
	params: Promise<{ id: string }>;
}

export default async function ProviderPage({ params }: ProviderPageProps) {
	const { id } = await params;

	const provider = providerDefinitions.find((p) => p.id === id);

	if (!provider || provider.name === "LLM Gateway") {
		notFound();
	}

	// Convert ModelDefinition to ApiModel-like structure
	const convertToApiModel = (
		def: ModelDefinition,
		map: ProviderModelMapping,
		providerInfo: (typeof providerDefinitions)[number],
	): ModelWithProviders => ({
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
					externalId: map.externalId,
					inputPrice: map.inputPrice?.toString() ?? null,
					outputPrice: map.outputPrice?.toString() ?? null,
					cachedInputPrice: map.cachedInputPrice?.toString() ?? null,
					cacheWriteInputPrice: map.cacheWriteInputPrice?.toString() ?? null,
					cacheWriteInputPrice1h:
						map.cacheWriteInputPrice1h?.toString() ?? null,
					imageInputPrice: map.imageInputPrice?.toString() ?? null,
					imageOutputPrice: map.imageOutputPrice?.toString() ?? null,
					inputCharacterPrice: map.inputCharacterPrice?.toString() ?? null,
					outputAudioPrice: map.outputAudioPrice?.toString() ?? null,
					imageInputTokensByResolution:
						map.imageInputTokensByResolution ?? null,
					imageOutputTokensByResolution:
						map.imageOutputTokensByResolution ?? null,
					requestPrice: map.requestPrice?.toString() ?? null,
					contextSize: map.contextSize ?? null,
					maxOutput: map.maxOutput ?? null,
					streaming: map.streaming === "only" ? true : (map.streaming ?? true),
					vision: map.vision ?? null,
					reasoning: map.reasoning ?? null,
					reasoningOutput: map.reasoningOutput ?? null,
					reasoningMaxTokens: map.reasoningMaxTokens ?? null,
					tools: map.tools ?? null,
					jsonOutput: map.jsonOutput ?? null,
					jsonOutputSchema: map.jsonOutputSchema ?? null,
					webSearch: map.webSearch ?? null,
					webSearchPrice: map.webSearchPrice?.toString() ?? null,
					supportedVideoSizes: map.supportedVideoSizes ?? null,
					supportedVideoDurationsSeconds:
						map.supportedVideoDurationsSeconds ?? null,
					supportsVideoAudio: map.supportsVideoAudio ?? null,
					supportsVideoWithoutAudio: map.supportsVideoWithoutAudio ?? null,
					perSecondPrice: map.perSecondPrice
						? Object.fromEntries(
								Object.entries(map.perSecondPrice).map(([k, v]) => [
									k,
									v.toString(),
								]),
							)
						: null,
					pricingTiers: map.pricingTiers
						? map.pricingTiers.map((t) => ({
								name: t.name,
								upToTokens: isFinite(t.upToTokens) ? t.upToTokens : null,
								inputPrice: String(t.inputPrice),
								outputPrice: String(t.outputPrice),
								cachedInputPrice:
									t.cachedInputPrice !== undefined
										? String(t.cachedInputPrice)
										: null,
								cacheReadInputPrice:
									t.cacheReadInputPrice !== undefined
										? String(t.cacheReadInputPrice)
										: null,
								cacheWriteInputPrice:
									t.cacheWriteInputPrice !== undefined
										? String(t.cacheWriteInputPrice)
										: null,
								cacheWriteInputPrice1h:
									t.cacheWriteInputPrice1h !== undefined
										? String(t.cacheWriteInputPrice1h)
										: null,
							}))
						: null,
					discount: null,
					stability: map.stability ?? null,
					supportedParameters: map.supportedParameters ?? null,
					deprecatedAt: map.deprecatedAt?.toISOString() ?? null,
					deactivatedAt: map.deactivatedAt?.toISOString() ?? null,
					status: "active",
				},
				providerInfo: {
					id: providerInfo.id,
					createdAt: new Date().toISOString(),
					name: providerInfo.name ?? null,
					description: providerInfo.description ?? null,
					streaming: providerInfo.streaming ?? null,
					cancellation: providerInfo.cancellation ?? null,
					color: providerInfo.color ?? null,
					website: providerInfo.website ?? null,
					announcement: providerInfo.announcement ?? null,
					status: "active",
				},
			},
		],
	});

	const providerModels: ModelWithProviders[] = modelDefinitions
		.filter((model) =>
			model.providers.some((p) => p.providerId === provider.id),
		)
		.map((model) => {
			const currentProviderMapping = model.providers.find(
				(p) => p.providerId === provider.id,
			)!;
			const providerInfo = providerDefinitions.find(
				(p) => p.id === provider.id,
			)!;

			return convertToApiModel(model, currentProviderMapping, providerInfo);
		})
		.sort((a, b) => {
			const aDate = a.releasedAt ? new Date(a.releasedAt).getTime() : 0;
			const bDate = b.releasedAt ? new Date(b.releasedAt).getTime() : 0;
			return bDate - aDate; // Descending (newest first)
		});

	const providerUrl = `https://llmgateway.io/providers/${provider.id}`;

	const organizationSchema = {
		"@context": "https://schema.org",
		"@type": "Organization",
		name: provider.name,
		url: provider.website ?? providerUrl,
		...(provider.description ? { description: provider.description } : {}),
		subjectOf: {
			"@type": "WebPage",
			url: providerUrl,
		},
	};

	const itemListSchema = {
		"@context": "https://schema.org",
		"@type": "ItemList",
		name: `${provider.name} models on LLM Gateway`,
		numberOfItems: providerModels.length,
		itemListElement: providerModels.map((model, index) => ({
			"@type": "ListItem",
			position: index + 1,
			url: `https://llmgateway.io/models/${encodeURIComponent(model.id)}`,
			name: model.name ?? model.id,
		})),
	};

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
				name: "Providers",
				item: "https://llmgateway.io/providers",
			},
			{
				"@type": "ListItem",
				position: 3,
				name: provider.name,
				item: providerUrl,
			},
		],
	};

	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<JsonLd data={[organizationSchema, itemListSchema, breadcrumbSchema]} />
			<main>
				<Navbar />
				<Hero providerId={provider.id} />

				<section className="py-12 bg-background">
					<div className="container mx-auto px-4">
						<h2 className="text-3xl font-bold mb-8">Available Models</h2>
						<ProviderModelsGrid models={providerModels} />
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}

export async function generateStaticParams() {
	return providerDefinitions
		.filter((provider) => provider.name !== "LLM Gateway")
		.map((provider) => ({
			id: provider.id,
		}));
}

export async function generateMetadata({
	params,
}: ProviderPageProps): Promise<Metadata> {
	const { id } = await params;

	const provider = providerDefinitions.find((p) => p.id === id);

	if (!provider || provider.name === "LLM Gateway") {
		return {};
	}

	const modelCount = modelDefinitions.filter((model) =>
		model.providers.some((p) => p.providerId === provider.id),
	).length;
	const description = `Access ${modelCount} ${provider.name} models through LLM Gateway's OpenAI-compatible API with per-token pricing, automatic fallback, caching, and cost analytics.`;

	return {
		title: `${provider.name} API — Models & Pricing`,
		description,
		alternates: { canonical: `/providers/${provider.id}` },
		openGraph: {
			title: `${provider.name} API — Models & Pricing | LLM Gateway`,
			description,
			type: "website",
			url: `https://llmgateway.io/providers/${provider.id}`,
		},
		twitter: {
			card: "summary_large_image",
			title: `${provider.name} API — Models & Pricing | LLM Gateway`,
			description,
		},
	};
}
