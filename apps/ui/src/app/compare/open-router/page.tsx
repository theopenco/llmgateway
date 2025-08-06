import { HeroCompare } from "@/components/compare/hero-compare";
import { Comparison } from "@/components/landing/comparison";
import Footer from "@/components/landing/footer";

export default function CompareOpenRouterPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare />
				<Comparison />
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "LLM Gateway vs OpenRouter - Feature Comparison | LLM Gateway",
		description:
			"Compare LLM Gateway's advanced routing, analytics, and cost optimization features against OpenRouter's basic proxy service. See why developers choose our unified API gateway for production LLM applications.",
		openGraph: {
			title: "LLM Gateway vs OpenRouter - Feature Comparison",
			description:
				"Compare LLM Gateway's advanced routing, analytics, and cost optimization features against OpenRouter's basic proxy service. See why developers choose our unified API gateway for production LLM applications.",
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs OpenRouter - Feature Comparison",
			description:
				"Compare LLM Gateway's advanced routing, analytics, and cost optimization features against OpenRouter's basic proxy service.",
		},
	};
}
