import Link from "next/link";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import { TokenCounterClient } from "@/components/token-tools/token-counter-client";

import type { Metadata } from "next";

const PAGE_URL = "https://llmgateway.io/token-counter";
const TITLE = "LLM Token Counter — Count Tokens Online, Free";
const DESCRIPTION =
	"Free online token counter. Paste text to count tokens, words, and characters with a real tokenizer that runs in your browser. Nothing is uploaded.";

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
		question: "How many tokens is my text?",
		answer:
			"Paste the text into the counter above. As a rule of thumb, one token is about four characters of English, so 1,000 tokens is roughly 750 words. Code and non-English text usually use more tokens per word.",
	},
	{
		question: "Which tokenizer does this token counter use?",
		answer:
			"It uses o200k_base, the tokenizer used by current OpenAI model families. The count is exact for those models and a close estimate for models from other labs, which use their own tokenizers.",
	},
	{
		question: "Is my text sent to a server?",
		answer:
			"No. The tokenizer is downloaded to your browser and the count is computed there. The text you paste never leaves your device.",
	},
	{
		question: "Why do token counts differ between models?",
		answer:
			"Each model family splits text with its own tokenizer, so the same text produces a different number of tokens on different models. For billing, rely on the usage figures returned by the API.",
	},
];

const appSchema = {
	"@context": "https://schema.org",
	"@type": "WebApplication",
	name: "LLM Token Counter",
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
			name: "LLM Token Counter",
			item: PAGE_URL,
		},
	],
};

export default function TokenCounterPage() {
	return (
		<>
			<JsonLd data={[appSchema, faqSchema, breadcrumbSchema]} />
			<Navbar />
			<main className="min-h-screen bg-background pt-24 pb-16 md:pt-32">
				<div className="container mx-auto max-w-5xl px-4">
					<header className="mb-8 max-w-3xl">
						<h1 className="text-3xl font-bold tracking-tight md:text-5xl">
							LLM Token Counter
						</h1>
						<p className="mt-4 text-lg text-muted-foreground">
							Paste text to count its tokens, words, and characters. The
							tokenizer runs in your browser, so your text is not uploaded.
						</p>
					</header>
					<TokenCounterClient />
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
							Need the price as well? The{" "}
							<Link
								href="/token-cost-calculator"
								className="font-medium text-foreground underline underline-offset-4"
							>
								token cost calculator
							</Link>{" "}
							turns a token count into a cost for each model, and the{" "}
							<Link
								href="/context-window-checker"
								className="font-medium text-foreground underline underline-offset-4"
							>
								context window checker
							</Link>{" "}
							shows which models your text fits in.
						</p>
					</section>
				</div>
			</main>
			<Footer />
		</>
	);
}
