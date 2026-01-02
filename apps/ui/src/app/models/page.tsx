import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";

export const metadata = {
	title: "AI Models Directory - Compare LLM Models & Providers | LLM Gateway",
	description:
		"Browse and compare 100+ AI models from leading providers like OpenAI, Anthropic, Google, and more. Filter by capabilities, pricing, and context size. Find the perfect LLM for your application.",
	openGraph: {
		title: "AI Models Directory - Compare LLM Models & Providers",
		description:
			"Browse and compare 100+ AI models from leading providers like OpenAI, Anthropic, Google, and more. Filter by capabilities, pricing, and context size.",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "AI Models Directory - Compare LLM Models & Providers",
		description:
			"Browse and compare 100+ AI models from leading providers. Filter by capabilities, pricing, and context size.",
	},
};

export default function ModelsPage() {
	return (
		<AllModels>
			<HeroRSC navbarOnly sticky={false} />
		</AllModels>
	);
}
