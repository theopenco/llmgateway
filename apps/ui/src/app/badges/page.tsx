import Link from "next/link";

import { BadgeBuilder } from "@/components/badges/badge-builder";
import { CompareFaq } from "@/components/compare/compare-faq";
import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import { statusProviders } from "@/lib/provider-status";

import {
	isLiveMapping,
	models as modelDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";

import type { Metadata } from "next";

const PAGE_URL = "https://llmgateway.io/badges";
const title = "LLM Status & Pricing Badges for Your README";
const description =
	"Free embeddable SVG badges with live data: measured uptime for every LLM provider and the current lowest price for every model. Copy the Markdown or HTML and paste.";

export const metadata: Metadata = {
	title,
	description,
	alternates: { canonical: PAGE_URL },
	openGraph: { title, description, type: "website", url: PAGE_URL },
	twitter: { card: "summary_large_image", title, description },
};

const faqs = [
	{
		question: "Where does the uptime number come from?",
		answer:
			"From real requests routed through LLM Gateway on platform credentials. Client errors are excluded, so the figure reflects the provider, not the callers. It is the same measurement shown on the provider status pages.",
	},
	{
		question: "How fresh are the badges?",
		answer:
			"Badges are cached for five minutes. Image proxies such as GitHub's may keep their own copy a little longer.",
	},
	{
		question: "Which price does the model badge show?",
		answer:
			"The lowest input and output price per million tokens among the providers currently serving that model on LLM Gateway.",
	},
	{
		question: "Are the badges free to use?",
		answer:
			"Yes, with no key and no sign-up. We ask that you keep the link back to the status or model page, which the generated snippets include.",
	},
];

export default function BadgesPage() {
	const providers = statusProviders
		.map((provider) => ({ id: provider.id, name: provider.name }))
		.sort((a, b) => a.name.localeCompare(b.name));
	const now = new Date();
	const models = (modelDefinitions as readonly ModelDefinition[])
		.filter(
			(model) =>
				model.family !== "llmgateway" &&
				model.providers.some(
					(mapping) =>
						mapping.inputPrice !== undefined &&
						mapping.outputPrice !== undefined &&
						isLiveMapping(mapping, now),
				),
		)
		.map((model) => ({ id: model.id, name: model.name ?? model.id }));

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
				{ "@type": "ListItem", position: 2, name: "Badges", item: PAGE_URL },
			],
		},
		{
			"@context": "https://schema.org",
			"@type": "SoftwareApplication",
			name: title,
			applicationCategory: "DeveloperApplication",
			operatingSystem: "Web",
			url: PAGE_URL,
			description,
			offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
		},
	];

	return (
		<>
			<JsonLd data={schema} />
			<Navbar />
			<div className="min-h-screen bg-background pt-24 pb-16 md:pt-32">
				<div className="container mx-auto px-4 py-8">
					<div className="mb-10 max-w-2xl">
						<p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Free tool
						</p>
						<h1 className="text-3xl font-bold tracking-tight md:text-5xl">
							Live LLM status and pricing badges
						</h1>
						<p className="mt-4 text-muted-foreground md:text-lg">
							Show measured provider uptime or a model's current price in your
							README, docs or status page. Pick one, copy the snippet, paste it.
						</p>
					</div>
					<BadgeBuilder providers={providers} models={models} />
					<section className="mt-16 max-w-3xl">
						<h2 className="text-2xl font-bold tracking-tight md:text-3xl">
							What the badges measure
						</h2>
						<p className="mt-4 text-muted-foreground">
							The uptime badge is the share of requests a provider answered
							without a gateway or upstream error, over the last 90 days or 24
							hours. It matches the{" "}
							<Link href="/status" className="underline underline-offset-4">
								provider status pages
							</Link>
							. The price badge reads the{" "}
							<Link href="/models" className="underline underline-offset-4">
								model catalogue
							</Link>{" "}
							and updates when a price changes.
						</p>
					</section>
				</div>
				<CompareFaq heading="Badges, answered" faqs={faqs} />
			</div>
			<Footer />
		</>
	);
}
