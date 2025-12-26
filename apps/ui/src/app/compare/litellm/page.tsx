import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonLiteLLM } from "@/components/landing/comparison-litellm";
import Footer from "@/components/landing/footer";

export default function CompareLiteLLMPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "Why Choose LLM Gateway Over LiteLLM?",
						description:
							"Compare our production-ready managed gateway with advanced analytics, routing, and enterprise features against LiteLLM's self-hosted proxy solution.",
						badges: [
							"Managed Infrastructure",
							"Advanced Analytics",
							"Enterprise Support",
							"Production Ready",
						],
						cta: {
							primary: {
								text: "Start for Free",
								href: "/signup",
							},
							secondary: {
								text: "View Documentation",
								href: "https://docs.llmgateway.io",
								external: true,
							},
						},
					}}
				/>
				<ComparisonLiteLLM />
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "LLM Gateway vs LiteLLM - Feature Comparison | LLM Gateway",
		description:
			"Compare LLM Gateway's managed infrastructure, advanced analytics, and enterprise features against LiteLLM's self-hosted proxy solution. See why teams choose our production-ready API gateway.",
		openGraph: {
			title: "LLM Gateway vs LiteLLM - Feature Comparison",
			description:
				"Compare LLM Gateway's managed infrastructure, advanced analytics, and enterprise features against LiteLLM's self-hosted proxy solution. See why teams choose our production-ready API gateway.",
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs LiteLLM - Feature Comparison",
			description:
				"Compare LLM Gateway's managed infrastructure, advanced analytics, and enterprise features against LiteLLM's self-hosted proxy solution.",
		},
	};
}
