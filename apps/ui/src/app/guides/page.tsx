import { IntegrationCards } from "@/components/integrations/integration-cards";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { JsonLd } from "@/components/seo/json-ld";

import { allGuides } from "content-collections";

export const metadata = {
	title: "Guides — Integrate with Claude Code, Cursor, Cline",
	description:
		"Step-by-step guides for integrating LLM Gateway with Claude Code, Cursor, Cline, n8n, and more.",
	openGraph: {
		title: "Guides — Integrate with Claude Code, Cursor, Cline",
		description:
			"Step-by-step guides for integrating LLM Gateway with Claude Code, Cursor, Cline, n8n, and more.",
	},
};

const collectionSchema = {
	"@context": "https://schema.org",
	"@type": "CollectionPage",
	name: "LLM Gateway Guides",
	description:
		"Step-by-step guides for integrating LLM Gateway with Claude Code, Cursor, Cline, n8n, and more.",
	url: "https://llmgateway.io/guides",
	mainEntity: {
		"@type": "ItemList",
		numberOfItems: allGuides.length,
		itemListElement: allGuides.map((guide, index) => ({
			"@type": "ListItem",
			position: index + 1,
			url: `https://llmgateway.io/guides/${guide.slug}`,
			name: guide.title,
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
			name: "Guides",
			item: "https://llmgateway.io/guides",
		},
	],
};

export default function GuidesPage() {
	return (
		<div>
			<JsonLd data={[collectionSchema, breadcrumbSchema]} />
			<HeroRSC navbarOnly />
			<section className="py-20 sm:py-28">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-2xl text-center mb-16">
						<h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
							Guides
						</h1>
						<p className="text-lg text-muted-foreground leading-relaxed">
							Step-by-step tutorials to help you integrate LLM Gateway with your
							favorite development tools and workflows.
						</p>
					</div>
					<IntegrationCards />
				</div>
			</section>
			<Footer />
		</div>
	);
}
