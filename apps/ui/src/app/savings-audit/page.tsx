import { CompareFaq } from "@/components/compare/compare-faq";
import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { SavingsAuditClient } from "@/components/savings-audit/savings-audit-client";
import { JsonLd } from "@/components/seo/json-ld";

import type { Metadata } from "next";

const PAGE_URL = "https://llmgateway.io/savings-audit";
const title = "LLM Savings Audit — Check Your AI API Bill";
const description =
	"Free LLM cost audit. Upload a usage export from OpenRouter, OpenAI or another platform and compare what you paid with the cheapest provider for every model. Runs in your browser.";

export const metadata: Metadata = {
	title,
	description,
	alternates: { canonical: PAGE_URL },
	openGraph: { title, description, type: "website", url: PAGE_URL },
	twitter: { card: "summary_large_image", title, description },
};

const faqs = [
	{
		question: "Which files can I audit?",
		answer:
			"Any CSV with one column for the model and columns for input and output tokens. Activity and usage exports from most LLM platforms work as they are. If a column is not recognized, pick it by hand after loading the file.",
	},
	{
		question: "Is my usage data uploaded?",
		answer:
			"No. The file is parsed in your browser and nothing in it is sent to our servers. Only the per-model totals shown on the page are computed, and they stay on the page.",
	},
	{
		question: "How is the LLM Gateway cost calculated?",
		answer:
			"Each model in your file is matched to the catalogue and priced at the cheapest provider currently serving it, using that provider's input, cached input and output prices. The platform fee charged on credits is then added to the total.",
	},
	{
		question: "What if my file has no cost column?",
		answer:
			"Then the comparison uses each model's list price at the lab that built it as the baseline, and says so above the result.",
	},
	{
		question: "What is left out?",
		answer:
			"Models without a priced match are excluded from both totals and listed under the table. Per-request fees, image and audio pricing, and long-context price tiers are not modelled, so treat the result as an estimate for text workloads.",
	},
];

const schema = [
	{
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
				name: "Savings Audit",
				item: PAGE_URL,
			},
		],
	},
	{
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "LLM Savings Audit",
		applicationCategory: "FinanceApplication",
		operatingSystem: "Web",
		url: PAGE_URL,
		description,
		offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
		publisher: {
			"@type": "Organization",
			name: "LLM Gateway",
			url: "https://llmgateway.io",
		},
	},
];

export default function SavingsAuditPage() {
	return (
		<>
			<JsonLd data={schema} />
			<Navbar />
			<div className="min-h-screen bg-background">
				<SavingsAuditClient />
				<section className="container mx-auto max-w-3xl px-4 pb-16">
					<h2 className="text-2xl font-bold tracking-tight md:text-3xl">
						How the audit works
					</h2>
					<ol className="mt-4 list-decimal space-y-2 pl-5 text-muted-foreground">
						<li>
							Your CSV is read row by row in the browser and summed per model.
						</li>
						<li>
							Model names are matched to the catalogue, ignoring vendor prefixes
							and dated snapshot suffixes.
						</li>
						<li>
							Each model is priced at the cheapest provider serving it today,
							with cached input billed at the cached rate.
						</li>
						<li>
							The total, including the platform fee, is set against what your
							file says you paid.
						</li>
					</ol>
				</section>
				<CompareFaq heading="Savings audit, answered" faqs={faqs} />
			</div>
			<Footer />
		</>
	);
}
