import dynamic from "next/dynamic";

import { integrations } from "@/components/integrations/integration-cards";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { JsonLd } from "@/components/seo/json-ld";

const IntegrationCards = dynamic(() =>
	import("@/components/integrations/integration-cards").then(
		(mod) => mod.IntegrationCards,
	),
);
const Footer = dynamic(() => import("@/components/landing/footer"));

const PAGE_URL = "https://llmgateway.io/integrations";
const TITLE = "Integrations — Claude Code, Cursor, Cline, n8n";
const DESCRIPTION =
	"Connect LLM Gateway with your favorite tools. Integrate with Claude Code, Cursor, Cline, n8n, and more.";

export const metadata = {
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

const availableIntegrations = integrations.filter(
	(integration) => !integration.comingSoon,
);

const collectionSchema = {
	"@context": "https://schema.org",
	"@type": "CollectionPage",
	name: "LLM Gateway integrations",
	url: PAGE_URL,
	description: DESCRIPTION,
	mainEntity: {
		"@type": "ItemList",
		numberOfItems: availableIntegrations.length,
		itemListElement: availableIntegrations.map((integration, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: integration.name,
			description: integration.description,
			url: new URL(integration.href, PAGE_URL).toString(),
		})),
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
			name: "Integrations",
			item: PAGE_URL,
		},
	],
};

export default function IntegrationsPage() {
	return (
		<div>
			<JsonLd data={[collectionSchema, breadcrumbSchema]} />
			<HeroRSC />
			<section className="py-20 sm:py-28">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-2xl text-center mb-16">
						<h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
							Integrations
						</h1>
						<p className="text-lg text-muted-foreground leading-relaxed">
							Connect LLM Gateway with your favorite tools and workflows. Access
							powerful AI capabilities wherever you work.
						</p>
					</div>
					<IntegrationCards />
				</div>
			</section>
			<Footer />
		</div>
	);
}
