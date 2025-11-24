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

import type { Metadata } from "next";

interface ModelWithProviders extends ModelDefinition {
	providerDetails: Array<{
		provider: ProviderModelMapping;
		providerInfo: (typeof providerDefinitions)[number];
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

			return {
				...model,
				providerDetails: [
					{
						provider: currentProviderMapping,
						providerInfo,
					},
				],
			} as ModelWithProviders;
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
