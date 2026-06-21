import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import Markdown from "markdown-to-jsx";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";
import { getMarkdownOptions } from "@/lib/utils/markdown";

import { allUseCases } from "content-collections";

import type { UseCase } from "content-collections";
import type { Metadata } from "next";

const BASE_URL = "https://llmgateway.io";

interface UseCasePageProps {
	params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
	return allUseCases
		.filter((entry: UseCase) => !entry.draft)
		.map((entry: UseCase) => ({ slug: entry.slug }));
}

export async function generateMetadata({
	params,
}: UseCasePageProps): Promise<Metadata> {
	const { slug } = await params;

	const entry = allUseCases.find((entry: UseCase) => entry.slug === slug);

	if (!entry) {
		return {};
	}

	return {
		title: entry.metaTitle ?? entry.title,
		description: entry.description,
		alternates: { canonical: `/use-cases/${entry.slug}` },
		openGraph: {
			title: entry.metaTitle ?? entry.title,
			description: entry.description,
			type: "article",
			url: `${BASE_URL}/use-cases/${entry.slug}`,
			images: ["/opengraph.png"],
		},
		twitter: {
			card: "summary_large_image",
			title: entry.metaTitle ?? entry.title,
			description: entry.description,
		},
	};
}

export default async function UseCasePage({ params }: UseCasePageProps) {
	const { slug } = await params;

	const entry = allUseCases.find((entry: UseCase) => entry.slug === slug);

	if (!entry || entry.draft) {
		notFound();
	}

	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
			{
				"@type": "ListItem",
				position: 2,
				name: "Use Cases",
				item: `${BASE_URL}/use-cases`,
			},
			{
				"@type": "ListItem",
				position: 3,
				name: entry.title,
				item: `${BASE_URL}/use-cases/${entry.slug}`,
			},
		],
	};

	const faqSchema =
		entry.faqs.length > 0
			? {
					"@context": "https://schema.org",
					"@type": "FAQPage",
					mainEntity: entry.faqs.map((item) => ({
						"@type": "Question",
						name: item.question,
						acceptedAnswer: {
							"@type": "Answer",
							text: item.answer,
						},
					})),
				}
			: null;

	return (
		<>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
			/>
			{faqSchema && (
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
				/>
			)}
			<HeroRSC navbarOnly />
			<div className="min-h-screen bg-background text-foreground pt-30">
				<main className="container mx-auto px-4 py-8">
					<div className="mx-auto max-w-4xl">
						<Link
							href="/use-cases"
							className="mb-8 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
						>
							<ArrowLeftIcon className="mr-2 h-4 w-4" />
							All use cases
						</Link>

						{/* Hero */}
						<header className="mb-12">
							<p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
								Use case
							</p>
							<h1 className="text-4xl font-bold tracking-tight md:text-5xl">
								{entry.title}
							</h1>
							<p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
								{entry.headline}
							</p>
							<div className="mt-8 flex flex-col gap-3 sm:flex-row">
								<Button asChild size="lg">
									<AuthLink href="/signup">
										Start for free
										<ArrowRightIcon className="ml-2 h-4 w-4" />
									</AuthLink>
								</Button>
								<Button asChild size="lg" variant="outline">
									<Link href="/use-cases">Explore use cases</Link>
								</Button>
							</div>
						</header>

						{/* Benefits */}
						{entry.benefits.length > 0 && (
							<div className="mb-14 grid gap-5 sm:grid-cols-2">
								{entry.benefits.map((benefit) => (
									<div
										key={benefit.title}
										className="rounded-2xl border border-border bg-card p-6"
									>
										<h3 className="text-lg font-semibold text-foreground">
											{benefit.title}
										</h3>
										<p className="mt-2 text-sm leading-6 text-muted-foreground">
											{benefit.description}
										</p>
									</div>
								))}
							</div>
						)}

						{/* Long-form body */}
						<article className="max-w-3xl">
							<Markdown options={getMarkdownOptions()}>
								{entry.content}
							</Markdown>
						</article>

						{/* FAQ */}
						{entry.faqs.length > 0 && (
							<section className="mt-16 max-w-3xl border-t border-border pt-12">
								<h2 className="mb-8 text-2xl font-bold tracking-tight md:text-3xl">
									Frequently asked questions
								</h2>
								<div className="divide-y divide-border">
									{entry.faqs.map((item) => (
										<div key={item.question} className="py-5">
											<h3 className="text-lg font-medium text-foreground">
												{item.question}
											</h3>
											<p className="mt-2 leading-7 text-muted-foreground">
												{item.answer}
											</p>
										</div>
									))}
								</div>
							</section>
						)}

						{/* CTA */}
						<section className="mt-16 mb-8 rounded-2xl border border-border bg-card p-8 text-center sm:p-12">
							<h2 className="text-2xl font-bold tracking-tight md:text-3xl">
								One API for every model
							</h2>
							<p className="mx-auto mt-3 max-w-xl text-muted-foreground">
								Route across 280+ models with fallback, caching and per-request
								cost analytics. Start free in minutes.
							</p>
							<div className="mt-6 flex justify-center">
								<Button asChild size="lg">
									<AuthLink href="/signup">
										Get started
										<ArrowRightIcon className="ml-2 h-4 w-4" />
									</AuthLink>
								</Button>
							</div>
						</section>
					</div>
				</main>
				<Footer />
			</div>
		</>
	);
}
