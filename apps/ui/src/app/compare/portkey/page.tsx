import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonPortkey } from "@/components/landing/comparison-portkey";
import Footer from "@/components/landing/footer";

export default function ComparePortkeyPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "Looking for a Portkey Alternative?",
						description:
							"Compare LLM Gateway's fully open-source platform, automatic provider routing, and transparent pricing against Portkey's gateway and LLMOps suite.",
						badges: [
							"Fully Open Source",
							"Automatic Routing",
							"Image & Video Gen",
							"Transparent Pricing",
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
				<ComparisonPortkey />
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "LLM Gateway vs Portkey — The Open Portkey Alternative",
		description:
			"Compare LLM Gateway's fully open-source platform, automatic provider routing, image and video generation, and transparent pricing against Portkey's gateway and LLMOps suite. See why teams pick LLM Gateway as their Portkey alternative.",
		openGraph: {
			title: "LLM Gateway vs Portkey - Feature Comparison",
			description:
				"Compare LLM Gateway's fully open-source platform, automatic provider routing, and transparent pricing against Portkey's gateway and LLMOps suite.",
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs Portkey - Feature Comparison",
			description:
				"Compare LLM Gateway's fully open-source platform, automatic provider routing, and transparent pricing against Portkey's gateway and LLMOps suite.",
		},
	};
}
