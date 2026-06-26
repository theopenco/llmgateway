import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { CALCULATOR_FAQ } from "@/components/token-cost-calculator/faq-data";
import { TokenCostCalculatorClient } from "@/components/token-cost-calculator/token-cost-calculator-client";
import { TokenCostCalculatorContent } from "@/components/token-cost-calculator/token-cost-calculator-content";

import type { Metadata } from "next";

const PAGE_URL = "https://llmgateway.io/token-cost-calculator";

export const metadata: Metadata = {
	title: "LLM Token Cost Calculator & Tokenizer — Compare AI Pricing",
	description:
		"Free LLM token counter and cost calculator. Paste any prompt to count its exact tokens with a real tokenizer, then compare what it costs on GPT-5, GPT-4o, Claude, Gemini, and 280+ models — at LLM Gateway's cheapest-provider rate with zero markup.",
	keywords: [
		"LLM token cost calculator",
		"token counter",
		"LLM tokenizer",
		"count tokens",
		"how many tokens",
		"AI API pricing calculator",
		"GPT-4o pricing",
		"GPT-5 pricing",
		"Claude API cost",
		"Gemini API pricing",
		"LLM pricing comparison",
		"cheapest LLM API",
	],
	alternates: {
		canonical: "/token-cost-calculator",
	},
	openGraph: {
		type: "website",
		url: PAGE_URL,
		title: "LLM Token Cost Calculator & Tokenizer — Compare AI Pricing",
		description:
			"Paste a prompt to count its exact tokens, then compare the cost across GPT-5, Claude, Gemini, and 280+ models at LLM Gateway's cheapest-provider rate.",
		images: [{ url: "/opengraph.png?v=1" }],
	},
	twitter: {
		card: "summary_large_image",
		title: "LLM Token Cost Calculator & Tokenizer — Compare AI Pricing",
		description:
			"Count your prompt's exact tokens and compare the cost across 280+ LLMs, then see how much you save with LLM Gateway.",
		images: ["/opengraph.png?v=1"],
	},
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
			name: "Token Cost Calculator",
			item: PAGE_URL,
		},
	],
};

const appSchema = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: "LLM Token Cost Calculator & Tokenizer",
	applicationCategory: "FinanceApplication",
	operatingSystem: "Web",
	url: PAGE_URL,
	description:
		"Free tool to count the exact tokens in any prompt with a real BPE tokenizer and compare LLM costs across GPT-5, GPT-4o, Claude, Gemini, and 280+ models, with cheapest-provider routing from LLM Gateway.",
	offers: {
		"@type": "Offer",
		price: "0",
		priceCurrency: "USD",
	},
	publisher: {
		"@type": "Organization",
		name: "LLM Gateway",
		url: "https://llmgateway.io",
	},
};

const faqSchema = {
	"@context": "https://schema.org",
	"@type": "FAQPage",
	mainEntity: CALCULATOR_FAQ.map((item) => ({
		"@type": "Question",
		name: item.question,
		acceptedAnswer: {
			"@type": "Answer",
			text: item.answer,
		},
	})),
};

export default function TokenCostCalculatorPage() {
	return (
		<div>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(appSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
			/>
			<HeroRSC navbarOnly />
			<TokenCostCalculatorClient />
			<TokenCostCalculatorContent />
			<Footer />
		</div>
	);
}
