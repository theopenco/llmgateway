import { CopilotCostCalculatorClient } from "@/components/copilot-cost-calculator/copilot-cost-calculator-client";
import { CopilotCostCalculatorContent } from "@/components/copilot-cost-calculator/copilot-cost-calculator-content";
import { COPILOT_CALCULATOR_FAQ } from "@/components/copilot-cost-calculator/faq-data";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

import type { Metadata } from "next";

const PAGE_URL = "https://llmgateway.io/copilot-cost-calculator";

export const metadata: Metadata = {
	title: "GitHub Copilot Cost Calculator (2026 AI Credits)",
	description:
		"Free calculator for GitHub Copilot's usage-based AI Credits billing. Estimate your team's monthly Copilot bill and compare the same workload at pass-through token prices with caching and hard budget caps.",
	keywords: [
		"GitHub Copilot cost calculator",
		"Copilot pricing calculator",
		"Copilot AI Credits",
		"GitHub Copilot token billing",
		"Copilot enterprise cost",
		"GitHub Copilot pricing 2026",
		"AI coding cost calculator",
		"Copilot alternative pricing",
		"cap AI coding spend",
	],
	alternates: {
		canonical: "/copilot-cost-calculator",
	},
	openGraph: {
		type: "website",
		url: PAGE_URL,
		title: "GitHub Copilot Cost Calculator (2026 AI Credits) | LLM Gateway",
		description:
			"Model your team's Copilot AI Credits bill after the June 2026 change and compare the same workload routed through LLM Gateway.",
		images: [{ url: "/opengraph.png?v=1" }],
	},
	twitter: {
		card: "summary_large_image",
		title: "GitHub Copilot Cost Calculator (2026 AI Credits) | LLM Gateway",
		description:
			"Estimate your team's Copilot AI Credits bill and see what the same usage costs at pass-through token prices with caching.",
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
			name: "Copilot Cost Calculator",
			item: PAGE_URL,
		},
	],
};

const appSchema = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: "GitHub Copilot Cost Calculator",
	applicationCategory: "FinanceApplication",
	operatingSystem: "Web",
	url: PAGE_URL,
	description:
		"Free tool to estimate a team's monthly GitHub Copilot bill under the June 2026 AI Credits billing model — seats, included credits, chat, and agent usage — and compare the same workload routed through LLM Gateway at pass-through token prices with prompt caching and hard budget caps.",
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
	mainEntity: COPILOT_CALCULATOR_FAQ.map((item) => ({
		"@type": "Question",
		name: item.question,
		acceptedAnswer: {
			"@type": "Answer",
			text: item.answer,
		},
	})),
};

export default function CopilotCostCalculatorPage() {
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
			<CopilotCostCalculatorClient />
			<CopilotCostCalculatorContent />
			<Footer />
		</div>
	);
}
