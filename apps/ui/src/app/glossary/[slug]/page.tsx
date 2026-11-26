import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import {
	getGlossaryTerm,
	GLOSSARY_UPDATED_AT,
	glossaryTerms,
	type GlossaryTerm,
} from "@/lib/glossary";
import { pageTitle } from "@/lib/page-title";

import type { Metadata, Route } from "next";

interface PageProps {
	params: Promise<{ slug: string }>;
}

const BASE_URL = "https://llmgateway.io";

function GlossaryLink({ href, label }: { href: string; label: string }) {
	const className =
		"inline-flex items-center gap-1.5 font-medium underline underline-offset-4";
	const content = (
		<>
			{label}
			<ArrowRight className="h-3.5 w-3.5" aria-hidden />
		</>
	);
	return href.startsWith("http") ? (
		<a href={href} className={className}>
			{content}
		</a>
	) : (
		<Link href={href as Route} className={className}>
			{content}
		</Link>
	);
}

export default async function GlossaryTermPage({ params }: PageProps) {
	const { slug } = await params;
	const term = getGlossaryTerm(slug);
	if (!term) {
		notFound();
	}

	const url = `${BASE_URL}/glossary/${term.slug}`;
	const related = term.related
		.map((relatedSlug) => getGlossaryTerm(relatedSlug))
		.filter((item): item is GlossaryTerm => item !== undefined);

	const definedTermSchema = {
		"@context": "https://schema.org",
		"@type": "DefinedTerm",
		name: term.term,
		alternateName: term.aliases,
		description: term.definition,
		url,
		inDefinedTermSet: {
			"@type": "DefinedTermSet",
			name: "LLM Gateway AI & LLM glossary",
			url: `${BASE_URL}/glossary`,
		},
	};
	const faqSchema = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: [
			{
				"@type": "Question",
				name: term.question,
				acceptedAnswer: { "@type": "Answer", text: term.definition },
			},
		],
	};
	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
			{
				"@type": "ListItem",
				position: 2,
				name: "Glossary",
				item: `${BASE_URL}/glossary`,
			},
			{ "@type": "ListItem", position: 3, name: term.term, item: url },
		],
	};

	return (
		<>
			<JsonLd data={[definedTermSchema, faqSchema, breadcrumbSchema]} />
			<Navbar />
			<main className="min-h-screen bg-background pt-24 pb-16 md:pt-32">
				<article className="container mx-auto max-w-3xl px-4">
					<nav aria-label="Breadcrumb" className="mb-6 text-sm">
						<ol className="flex flex-wrap items-center gap-2 text-muted-foreground">
							<li>
								<Link href="/glossary" className="hover:text-foreground">
									Glossary
								</Link>
							</li>
							<li aria-hidden>/</li>
							<li className="text-foreground" aria-current="page">
								{term.term}
							</li>
						</ol>
					</nav>
					<header className="mb-8">
						<h1 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">
							{term.question}
						</h1>
						<p className="mt-4 text-lg leading-relaxed">{term.definition}</p>
						<p className="mt-3 text-sm text-muted-foreground">
							Also called: {term.aliases.join(", ")} · Last updated{" "}
							<time dateTime={GLOSSARY_UPDATED_AT}>
								{new Date(GLOSSARY_UPDATED_AT).toLocaleDateString("en-US", {
									year: "numeric",
									month: "long",
									day: "numeric",
									timeZone: "UTC",
								})}
							</time>
						</p>
					</header>

					{term.sections.map((section) => (
						<section key={section.heading} className="mb-8">
							<h2 className="mb-2 text-xl font-semibold md:text-2xl">
								{section.heading}
							</h2>
							<p className="leading-relaxed text-muted-foreground">
								{section.text}
							</p>
						</section>
					))}

					<section className="mb-10">
						<h2 className="mb-3 text-xl font-semibold md:text-2xl">
							Learn more
						</h2>
						<ul className="space-y-2">
							{term.links.map((link) => (
								<li key={link.href}>
									<GlossaryLink href={link.href} label={link.label} />
								</li>
							))}
						</ul>
					</section>

					{related.length > 0 && (
						<section>
							<h2 className="mb-3 text-xl font-semibold md:text-2xl">
								Related terms
							</h2>
							<ul className="grid gap-2 sm:grid-cols-2">
								{related.map((item) => (
									<li key={item.slug}>
										<Link
											href={`/glossary/${item.slug}` as Route}
											className="block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
										>
											{item.term}
										</Link>
									</li>
								))}
							</ul>
						</section>
					)}
				</article>
			</main>
			<Footer />
		</>
	);
}

export function generateStaticParams() {
	return glossaryTerms.map((term) => ({ slug: term.slug }));
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { slug } = await params;
	const term = getGlossaryTerm(slug);
	if (!term) {
		return {};
	}
	const title = term.question;
	const description =
		term.definition.length > 160
			? `${term.definition.slice(0, 157).trimEnd()}...`
			: term.definition;
	const canonical = `${BASE_URL}/glossary/${term.slug}`;
	return {
		title: pageTitle(title),
		description,
		alternates: { canonical },
		openGraph: { title, description, type: "article", url: canonical },
		twitter: { card: "summary_large_image", title, description },
	};
}
