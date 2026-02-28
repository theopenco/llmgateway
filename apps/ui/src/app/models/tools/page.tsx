import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { AllModels } from "@/components/models/all-models";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export const metadata = {
	title: "Tool-Calling Models - AI Models with Function Calling | LLM Gateway",
	description:
		"Browse and compare AI models with tool and function calling support. Build agentic applications with models that can call APIs and execute functions.",
	openGraph: {
		title: "Tool-Calling Models - AI Models with Function Calling",
		description:
			"Browse and compare AI models with tool calling. Build agentic applications with function-calling capable LLMs.",
		type: "website",
	},
};

export default async function ToolsModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<Suspense>
			<AllModels
				models={models}
				providers={providers}
				title="Tool-Calling Models"
				description="Models with function and tool calling support for building agentic applications"
				categoryFilter="tools"
			>
				<HeroRSC navbarOnly sticky={false} />
			</AllModels>
		</Suspense>
	);
}
