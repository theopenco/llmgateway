import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { adaptProviderMapping } from "@/components/models/adapt-model";
import { Hero } from "@/components/providers/hero";
import { ProviderModelsGrid } from "@/components/providers/provider-models-grid";
import { ProviderStatsRow } from "@/components/providers/provider-stats-row";
import { JsonLd } from "@/components/seo/json-ld";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";
import { isPremiumModel } from "@llmgateway/shared";
import { isMappingDeactivated } from "@llmgateway/shared/components";

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

/**
 * Fallback for providers that exist only in the DB catalogue (custom Airside
 * carriers): the static definitions know nothing about them, so the page is
 * built from the API's provider + model data instead of 404ing.
 */
async function renderDynamicProviderPage(id: string) {
	const [apiProviders, apiModels] = await Promise.all([
		fetchProviders().catch(() => []),
		fetchModels().catch(() => []),
	]);
	const apiProvider = apiProviders.find((p) => p.id === id);
	if (!apiProvider) {
		return null;
	}
	const providerModels: ModelWithProviders[] = apiModels
		.filter((model) =>
			model.mappings.some(
				(mapping) => mapping.providerId === id && mapping.status === "active",
			),
		)
		.map((model) => ({
			...model,
			providerDetails: model.mappings
				.filter((mapping) => mapping.providerId === id)
				.map((mapping) => ({ provider: mapping, providerInfo: apiProvider })),
		}));
	const uploadedLogo = apiProvider.airsideLogoUrl ?? undefined;
	const description =
		apiProvider.description && apiProvider.description !== "(empty)"
			? apiProvider.description
			: null;

	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<Navbar />
				<Hero
					providerId={id as (typeof providerDefinitions)[number]["id"]}
					uploadedLogo={uploadedLogo}
					dynamicProvider={{ name: apiProvider.name ?? id, description }}
				/>
				<ProviderStatsRow providerId={id} />
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

export default async function ProviderPage({ params }: ProviderPageProps) {
	const { id } = await params;

	const provider = providerDefinitions.find((p) => p.id === id);

	if (!provider || provider.name === "LLM Gateway") {
		const dynamicPage = await renderDynamicProviderPage(id);
		if (dynamicPage) {
			return dynamicPage;
		}
		notFound();
	}

	const apiProviders = await fetchProviders().catch(() => []);
	const uploadedLogo =
		apiProviders.find((p) => p.id === id)?.airsideLogoUrl ?? undefined;

	const apiModels = await fetchModels();
	const discountByModelId = new Map<string, string>();
	for (const apiModel of apiModels) {
		for (const mapping of apiModel.mappings) {
			if (
				mapping.providerId === provider.id &&
				mapping.discount &&
				parseFloat(mapping.discount) > 0
			) {
				discountByModelId.set(apiModel.id, mapping.discount);
			}
		}
	}

	// Convert ModelDefinition to ApiModel-like structure
	const convertToApiModel = (
		def: ModelDefinition,
		map: ProviderModelMapping,
		providerInfo: (typeof providerDefinitions)[number],
	): ModelWithProviders => {
		const adapted = adaptProviderMapping(
			{
				...map,
				discount: discountByModelId.get(def.id) ?? null,
				providerInfo,
			},
			def.id,
		);

		return {
			id: def.id,
			premium: isPremiumModel(def.id),
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
						...adapted.provider,
						createdAt: new Date().toISOString(),
					},
					providerInfo: {
						...adapted.providerInfo,
						createdAt: new Date().toISOString(),
						cancellation: providerInfo.cancellation ?? null,
						announcement: providerInfo.announcement ?? null,
					},
				},
			],
		};
	};

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

	// Deactivated models are still reachable behind the grid's toggle, but they
	// are not part of what this provider currently offers.
	const activeProviderModels = providerModels.filter((model) =>
		model.providerDetails.some(
			({ provider: mapping }) => !isMappingDeactivated(mapping),
		),
	);

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
		numberOfItems: activeProviderModels.length,
		itemListElement: activeProviderModels.map((model, index) => ({
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
				<Hero providerId={provider.id} uploadedLogo={uploadedLogo} />

				<ProviderStatsRow providerId={provider.id} />

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
		const apiProvider = (await fetchProviders().catch(() => [])).find(
			(p) => p.id === id,
		);
		if (!apiProvider) {
			return {};
		}
		return {
			title: `${apiProvider.name} API — Models & Pricing`,
			alternates: { canonical: `/providers/${id}` },
		};
	}

	const modelCount = (modelDefinitions as readonly ModelDefinition[]).filter(
		(model) =>
			model.providers.some(
				(p) => p.providerId === provider.id && !isMappingDeactivated(p),
			),
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
