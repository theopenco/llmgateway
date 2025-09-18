import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/providers/hero";
import { ModelCard } from "@/components/shared/model-card";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@llmgateway/models";

import type { Metadata } from "next";

interface ProviderPageProps {
	params: Promise<{ id: string }>;
}

export default async function ProviderPage({ params }: ProviderPageProps) {
	const { id } = await params;

	const provider = providerDefinitions.find((p) => p.id === id);

	if (!provider || provider.name === "LLM Gateway") {
		notFound();
	}

	// Get models for this provider
	const providerModels = modelDefinitions.filter((model) =>
		model.providers.some((p) => p.providerId === provider.id),
	);

	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<Navbar />
				<Hero providerId={provider.id} />

				<section className="py-12 bg-background">
					<div className="container mx-auto px-4">
						<h2 className="text-3xl font-bold mb-8">Available Models</h2>
						<div className="grid gap-6 md:grid-cols-3">
							{providerModels.map((model) => (
								<ModelCard
									key={`${model.providers[0].providerId}-${model.id}`}
									modelName={model.id}
									providers={model.providers}
								/>
							))}
						</div>
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
