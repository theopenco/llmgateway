import Link from "next/link";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import { ContextWindowClient } from "@/components/token-tools/context-window-client";
import { comparisonModels } from "@/lib/model-comparisons";

import type { Metadata } from "next";

const PAGE_URL = "https://llmgateway.io/context-window-checker";
const TITLE = "Context Window Checker — Will Your Prompt Fit?";
const DESCRIPTION =
	"Free context window checker. Paste a prompt or enter a token count to see which LLMs it fits in, with each model's context window and max output.";

export const metadata: Metadata = {
	title: TITLE,
	description: DESCRIPTION,
	alternates: { canonical: PAGE_URL },
	openGraph: {
		title: TITLE,
		description: DESCRIPTION,
		type: "website",
		url: PAGE_URL,
	},
	twitter: {
		card: "summary_large_image",
		title: TITLE,
		description: DESCRIPTION,
	},
};

const faqs = [
	{
		question: "What is a context window?",
		answer:
			"A context window is the maximum number of tokens a model can process in one request, counting your prompt, any documents or history you include, and the response it generates.",
	},
	{
		question: "How do I know if my prompt fits a model?",
		answer:
			"Add the tokens in your prompt to the tokens you expect in the response. If the total is within the model's context window, and the response is within its maximum output, the request fits. The checker above does this for every model.",
	},
	{
		question: "Why reserve tokens for the output?",
		answer:
			"The response shares the context window with the prompt. A prompt that fills the window leaves no room for an answer, so the request is rejected or the answer is cut short.",
	},
	{
		question: "How accurate is the token count?",
		answer:
			"Text is counted with the o200k_base tokenizer, which is exact for current OpenAI models and an estimate for other families. Leave some margin when a prompt is close to a model's limit.",
	},
];

const appSchema = {
	"@context": "https://schema.org",
	"@type": "WebApplication",
	name: "Context Window Checker",
	url: PAGE_URL,
	description: DESCRIPTION,
	applicationCategory: "DeveloperApplication",
	operatingSystem: "Web",
	offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

const faqSchema = {
	"@context": "https://schema.org",
	"@type": "FAQPage",
	mainEntity: faqs.map((faq) => ({
		"@type": "Question",
		name: faq.question,
		acceptedAnswer: { "@type": "Answer", text: faq.answer },
	})),
};

const breadcrumbSchema = {
	"@context": "https://schema.org",
	"@type": "BreadcrumbList",
	itemListElement: [
		{
			"@type": "ListItem",
			position: 1,
			name: "Home",
			item: "https://llmgateway.io",
		},
		{
			"@type": "ListItem",
			position: 2,
			name: "Context Window Checker",
			item: PAGE_URL,
		},
	],
};

const models = comparisonModels
	.filter((model) => model.contextSize > 0)
	.map((model) => ({
		id: model.id,
		name: model.name,
		contextSize: model.contextSize,
		maxOutput: model.maxOutput,
	}))
	.sort((a, b) => b.contextSize - a.contextSize);

export default function ContextWindowCheckerPage() {
	return (
		<>
			<JsonLd data={[appSchema, faqSchema, breadcrumbSchema]} />
			<Navbar />
			<main className="min-h-screen bg-background pt-24 pb-16 md:pt-32">
				<div className="container mx-auto max-w-5xl px-4">
					<header className="mb-8 max-w-3xl">
						<h1 className="text-3xl font-bold tracking-tight md:text-5xl">
							Context Window Checker
						</h1>
						<p className="mt-4 text-lg text-muted-foreground">
							Paste a prompt or enter a token count to see which models it fits
							in, with room left for the response.
						</p>
					</header>
					<ContextWindowClient models={models} />
					<section className="mt-16 max-w-3xl">
						<h2 className="mb-6 text-2xl font-bold tracking-tight">
							Frequently asked questions
						</h2>
						<div className="space-y-6">
							{faqs.map((faq) => (
								<div key={faq.question}>
									<h3 className="mb-2 font-semibold">{faq.question}</h3>
									<p className="leading-relaxed text-muted-foreground">
										{faq.answer}
									</p>
								</div>
							))}
						</div>
						<p className="mt-8 text-muted-foreground">
							Context sizes come from the live{" "}
							<Link
								href="/models"
								className="font-medium text-foreground underline underline-offset-4"
							>
								model catalogue
							</Link>
							. See{" "}
							<Link
								href="/models/long-context"
								className="font-medium text-foreground underline underline-offset-4"
							>
								long-context models
							</Link>{" "}
							for the largest windows, or read{" "}
							<Link
								href="/glossary/context-window"
								className="font-medium text-foreground underline underline-offset-4"
							>
								what a context window is
							</Link>
							.
						</p>
					</section>
				</div>
			</main>
			<Footer />
		</>
	);
}
