import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/providers/hero";
import { ProviderModelsGrid } from "@/components/providers/provider-models-grid";

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

	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
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

	return {
		title: `${provider.name} - LLM Gateway`,
		description: `Learn about ${provider.name} integration with LLM Gateway. Access ${provider.name} models through our unified API.`,
		openGraph: {
			title: `${provider.name} - LLM Gateway`,
			description: `Learn about ${provider.name} integration with LLM Gateway. Access ${provider.name} models through our unified API.`,
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: `${provider.name} - LLM Gateway`,
			description: `Learn about ${provider.name} integration with LLM Gateway.`,
		},
	};
}
