import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { ProvidersGrid } from "@/components/providers/providers-grid";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "LLM Providers",
	description:
		"Browse 30+ LLM providers available through LLM Gateway — OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek, xAI, and more. One API for all of them.",
	openGraph: {
		title: "LLM Providers - LLM Gateway",
		description:
			"Browse 30+ LLM providers available through LLM Gateway — OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek, xAI, and more.",
	},
};

export default function ProvidersPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroRSC navbarOnly />
				<ProvidersGrid />
			</main>
			<Footer />
		</div>
	);
}
