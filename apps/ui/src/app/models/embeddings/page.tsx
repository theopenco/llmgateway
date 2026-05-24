import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	title: "Embedding Models - AI Text Embeddings",
	description:
		"Browse and compare AI embedding models for semantic search, RAG, and similarity. Generate vector embeddings with multiple providers.",
	openGraph: {
		title: "Embedding Models - AI Text Embeddings",
		description:
			"Browse and compare AI embedding models for semantic search, RAG, and similarity with multiple providers.",
		type: "website",
	},
};

export default async function EmbeddingModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<Suspense>
			<AllModels
				models={models}
				providers={providers}
				title="Embedding Models"
				description="Models that generate vector embeddings from text"
				categoryFilter="embedding"
			>
				<HeroRSC navbarOnly sticky={false} />
			</AllModels>
		</Suspense>
	);
}
