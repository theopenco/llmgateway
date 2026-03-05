import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	title: "Discounted Models - AI Models on Sale | LLM Gateway",
	description:
		"Browse and compare AI models with active discounts. Save on API costs with discounted pricing from multiple providers.",
	openGraph: {
		title: "Discounted Models - AI Models on Sale",
		description:
			"Browse and compare AI models with active discounts. Save on API costs with discounted pricing.",
		type: "website",
	},
};

export default async function DiscountedModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<Suspense>
			<AllModels
				models={models}
				providers={providers}
				title="Discounted Models"
				description="Models with active discounts — save on API costs"
				categoryFilter="discounted"
			>
				<HeroRSC navbarOnly sticky={false} />
			</AllModels>
		</Suspense>
	);
}
