import Link from "next/link";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import { glossaryTerms } from "@/lib/glossary";

import type { Metadata, Route } from "next";

const PAGE_URL = "https://llmgateway.io/glossary";
const TITLE = "AI & LLM Glossary — Key Terms Explained";
const DESCRIPTION =
	"Plain-language definitions of the terms used when building with LLM APIs: tokens, context windows, prompt caching, routing, fallback, TTFT, and more.";

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

const sortedTerms = [...glossaryTerms].sort((a, b) =>
	a.term.localeCompare(b.term),
);

const termSetSchema = {
	"@context": "https://schema.org",
	"@type": "DefinedTermSet",
	name: "LLM Gateway AI & LLM glossary",
	url: PAGE_URL,
	description: DESCRIPTION,
	hasDefinedTerm: sortedTerms.map((term) => ({
		"@type": "DefinedTerm",
		name: term.term,
		description: term.definition,
		url: `${PAGE_URL}/${term.slug}`,
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
		{ "@type": "ListItem", position: 2, name: "Glossary", item: PAGE_URL },
	],
};

export default function GlossaryPage() {
	return (
		<>
			<JsonLd data={[termSetSchema, breadcrumbSchema]} />
			<Navbar />
			<main className="min-h-screen bg-background pt-24 pb-16 md:pt-32">
				<div className="container mx-auto max-w-5xl px-4">
					<header className="mb-10 max-w-3xl">
						<h1 className="text-3xl font-bold tracking-tight md:text-5xl">
							AI &amp; LLM glossary
						</h1>
						<p className="mt-4 text-lg text-muted-foreground">
							Short, plain-language definitions of the terms you meet when
							building with LLM APIs.
						</p>
					</header>
					<ul className="grid gap-4 md:grid-cols-2">
						{sortedTerms.map((term) => (
							<li key={term.slug}>
								<Link
									href={`/glossary/${term.slug}` as Route}
									className="block h-full rounded-lg border p-5 transition-colors hover:bg-muted/50"
								>
									<h2 className="font-semibold">{term.term}</h2>
									<p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
										{term.definition}
									</p>
								</Link>
							</li>
						))}
					</ul>
				</div>
			</main>
			<Footer />
		</>
	);
}
