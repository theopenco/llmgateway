import { TimelineClient } from "@/components/timeline/timeline-client";
import { fetchModels } from "@/lib/fetch-models";

export const metadata = {
	title: "Model Timeline — When Each LLM Was Released",
	description:
		"Timeline of LLM releases — when each model shipped from its provider and when it was added to LLM Gateway. Track Claude, GPT, Gemini, Llama, and more.",
	openGraph: {
		title: "Model Timeline — When Each LLM Was Released",
		description:
			"Timeline of LLM releases — when each model shipped from its provider and when it was added to LLM Gateway.",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Model Timeline — When Each LLM Was Released",
		description:
			"Timeline of LLM releases — when each model shipped from its provider and when it was added to LLM Gateway.",
	},
};

export default async function TimelinePage() {
	const models = await fetchModels();

	return <TimelineClient models={models} />;
}
