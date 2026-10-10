import { CompareFaq } from "@/components/compare/compare-faq";
import { ComparisonSources } from "@/components/compare/comparison-sources";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonBedrock } from "@/components/landing/comparison-bedrock";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const bedrockFaqs: CompareFaqItem[] = [
	{
		question: "When is Amazon Bedrock a better fit?",
		answer:
			"Bedrock is a strong choice when model access, IAM, private networking and billing should stay within AWS. It also offers managed agents, knowledge bases and guardrails. LLM Gateway is useful when you need routing across independent providers as well as supported Bedrock models.",
	},
	{
		question: "Does Bedrock support OpenAI-compatible APIs?",
		answer:
			"Yes. Bedrock supports Chat Completions and Responses for supported models and endpoints. Current AWS guidance recommends bedrock-runtime for new integrations when the required features are available. Converse, InvokeModel and Anthropic Messages are also available; compatibility depends on the model.",
	},
	{
		question: "How does pricing compare?",
		answer:
			"Bedrock rates depend on the model, region and inference mode. Options include on-demand, batch, provisioned capacity and service tiers on supported models. Guardrails and other services can add charges. LLM Gateway adds a 5% credit-purchase fee or no BYOK platform fee; optional storage is separate.",
	},
	{
		question: "Does Bedrock already provide routing?",
		answer:
			"Yes. Cross-region inference distributes requests across AWS regions, and Intelligent Prompt Routing selects between supported models within a model family. These are different from routing between independent cloud providers. Check regional and model eligibility before relying on either.",
	},
	{
		question: "Can I keep my AWS credentials and agreements?",
		answer:
			"Yes, for supported Bedrock mappings. Your AWS account still determines permissions, quotas and provider billing. Adding a gateway changes the data path, so review its hosting and fallback configuration against your requirements.",
	},
	{
		question: "How do I migrate a Bedrock application?",
		answer:
			"An OpenAI-compatible client may need only endpoint, key and model changes. Applications using Converse or InvokeModel need request and response translation. AWS-specific agents, knowledge bases, guardrails and IAM settings are not migrated by changing a base URL.",
	},
];

export default function CompareBedrockPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "Looking Beyond AWS Bedrock?",
						description:
							"Bedrock gives you the models AWS hosts. LLM Gateway gives you multiple labs and clouds — including Bedrock itself — behind one open-source, OpenAI-compatible API with automatic routing and failover.",
						badges: [
							"Cloud-Neutral",
							"Open-Source Core",
							"Cross-Cloud Failover",
							"Bedrock Built In",
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
				<ComparisonBedrock />
				<ComparisonSources slug="aws-bedrock" />
				<CompareFaq
					heading="LLM Gateway vs AWS Bedrock"
					description="Common questions about using LLM Gateway alongside or instead of Amazon Bedrock."
					faqs={bedrockFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "LLM Gateway vs AWS Bedrock — The Cloud-Neutral Alternative",
		description:
			"Compare multiple providers behind one OpenAI-compatible API vs Amazon Bedrock. Keep Bedrock with 0% markup plus failover, caching, and cost analytics.",
		alternates: { canonical: "/compare/aws-bedrock" },
		openGraph: {
			title: "LLM Gateway vs AWS Bedrock — Feature Comparison",
			description:
				"Cloud-neutral gateway vs AWS Bedrock. Route to Bedrock and multiple providers from one API with failover and analytics.",
			type: "website",
			url: "https://llmgateway.io/compare/aws-bedrock",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs AWS Bedrock — Feature Comparison",
			description:
				"Cloud-neutral gateway vs AWS Bedrock. Route to Bedrock and multiple providers from one API.",
		},
	};
}
