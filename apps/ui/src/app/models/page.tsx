import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	title: "AI Models Directory - Compare LLM Models & Providers | LLM Gateway",
	description:
		"Browse and compare 180+ AI models from leading providers like OpenAI, Anthropic, Google, and more. Filter by capabilities, pricing, and context size. Find the perfect LLM for your application.",
	openGraph: {
		title: "AI Models Directory - Compare LLM Models & Providers",
		description:
			"Browse and compare 180+ AI models from leading providers like OpenAI, Anthropic, Google, and more. Filter by capabilities, pricing, and context size.",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "AI Models Directory - Compare LLM Models & Providers",
		description:
			"Browse and compare 180+ AI models from leading providers. Filter by capabilities, pricing, and context size.",
	},
};

export default async function ModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<Suspense>
			<AllModels models={models} providers={providers}>
				<HeroRSC navbarOnly sticky={false} />
			</AllModels>
		</Suspense>
	);
}
