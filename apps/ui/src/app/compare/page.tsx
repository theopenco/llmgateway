import { ArrowRight, ArrowUpRight, Scale } from "lucide-react";
import Link from "next/link";

import { CompetitorIcon } from "@/components/compare/competitor-icons";
import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { AuthLink } from "@/components/shared/auth-link";
import {
	comparisonCategories,
	comparisons,
	comparisonsByCategory,
} from "@/lib/comparisons";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { serializeJsonLd } from "@/lib/json-ld";

import { MARKETING_STATS } from "@llmgateway/shared";

import type { Route } from "next";
import type { Metadata } from "next";

const BASE_URL = "https://llmgateway.io";

const faqs = [
	{
		question: "What is the best OpenRouter or Portkey alternative?",
		answer:
			"LLM Gateway is an open-source AI gateway that routes requests to 40+ providers and 200+ models through one OpenAI-compatible endpoint. Unlike hosted-only alternatives, the whole platform is AGPLv3 licensed, so you can run it on your own infrastructure or use the managed service.",
	},
	{
		question: "How does LLM Gateway price against other AI gateways?",
		answer: `You pay providers their per-token rates plus a ${MARKETING_STATS.platformFee} platform fee on credits, or you bring your own provider keys and pay 0% markup. There are no per-seat licences and no request-volume tiers. Optional full request retention is billed at ${MARKETING_STATS.dataStoragePrice}.`,
	},
	{
		question: "Do I have to rewrite my code to switch?",
		answer:
			"No. LLM Gateway exposes an OpenAI-compatible API, so switching is a base URL and API key change in whichever SDK you already use. Step-by-step migration guides cover OpenRouter, Portkey, LiteLLM, Vercel AI Gateway, and GitHub Copilot.",
	},
	{
		question: "Can LLM Gateway sit in front of AWS Bedrock or Azure?",
		answer:
			"Yes. Bedrock and Azure are providers inside LLM Gateway rather than things it replaces. You can keep those contracts and route through them with your own keys at 0% markup, while gaining failover, caching, and cross-provider cost analytics.",
	},
	{
		question: "Is LLM Gateway actually open source?",
		answer:
			"Yes. The core platform — gateway, dashboard, and worker — is licensed under AGPLv3 and free to self-host forever. Some enterprise features live under a separate commercial licence in the ee/ directory.",
	},
];

export const metadata: Metadata = {
	title: "Compare LLM Gateway — AI Gateway Comparisons",
	description:
		"Side-by-side comparisons of LLM Gateway against OpenRouter, Portkey, LiteLLM, Vercel AI Gateway, AWS Bedrock, Azure AI Foundry, and GitHub Copilot.",
	alternates: { canonical: "/compare" },
	openGraph: {
		title: "Compare LLM Gateway — AI Gateway Comparisons",
		description:
			"Side-by-side comparisons against every major AI gateway, cloud model platform, and coding assistant.",
		type: "website",
		url: `${BASE_URL}/compare`,
	},
	twitter: {
		card: "summary_large_image",
		title: "Compare LLM Gateway — AI Gateway Comparisons",
		description:
			"Side-by-side comparisons against every major AI gateway, cloud model platform, and coding assistant.",
	},
};

export default function ComparePage() {
	const itemListSchema = {
		"@context": "https://schema.org",
		"@type": "ItemList",
		name: "LLM Gateway comparisons",
		description:
			"Side-by-side comparisons of LLM Gateway against other AI gateways, cloud model platforms, and coding assistants.",
		numberOfItems: comparisons.length,
		itemListElement: comparisons.map((comparison, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: `LLM Gateway vs ${comparison.competitor}`,
			url: `${BASE_URL}/compare/${comparison.slug}`,
		})),
	};

	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
			{
				"@type": "ListItem",
				position: 2,
				name: "Comparisons",
				item: `${BASE_URL}/compare`,
			},
		],
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

	return (
		<>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemListSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqSchema) }}
			/>

			<Navbar />

			<main className="relative min-h-screen overflow-hidden bg-background pt-20 md:pt-24">
				<div
					aria-hidden
					className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(56,189,248,0.12)_0%,transparent_70%)]"
				/>

				<section className="border-b border-border/60">
					<div className="container mx-auto px-4 py-12 md:py-16">
						<div className="mx-auto max-w-3xl space-y-5 text-center">
							<Badge
								variant="outline"
								className="gap-1.5 rounded-full px-3 py-1 text-xs"
							>
								<Scale className="h-3.5 w-3.5 text-sky-400" />
								Comparisons
							</Badge>
							<h1 className="font-display text-3xl font-bold tracking-tight text-balance md:text-5xl">
								LLM Gateway vs the alternatives
							</h1>
							<p className="mx-auto max-w-2xl text-balance text-sm text-muted-foreground md:text-base">
								LLM Gateway is an open-source AI gateway that routes requests to{" "}
								{MARKETING_STATS.providers} providers and{" "}
								{MARKETING_STATS.models} models through one OpenAI-compatible
								endpoint. These {comparisons.length} breakdowns show where it
								differs from the gateways, cloud platforms, and coding
								assistants teams usually evaluate alongside it.
							</p>

							<ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 pt-2 text-sm">
								<li className="flex items-baseline gap-1.5">
									<span className="font-display text-xl font-bold tabular-nums text-foreground">
										{comparisons.length}
									</span>
									<span className="text-muted-foreground">comparisons</span>
								</li>
								<li className="flex items-baseline gap-1.5 before:mr-6 before:text-border before:content-['•']">
									<span className="font-display text-xl font-bold tabular-nums text-foreground">
										{MARKETING_STATS.providers}
									</span>
									<span className="text-muted-foreground">providers</span>
								</li>
								<li className="flex items-baseline gap-1.5 before:mr-6 before:text-border before:content-['•']">
									<span className="font-display text-xl font-bold tabular-nums text-foreground">
										{MARKETING_STATS.models}
									</span>
									<span className="text-muted-foreground">models</span>
								</li>
								<li className="flex items-baseline gap-1.5 before:mr-6 before:text-border before:content-['•']">
									<span className="font-display text-xl font-bold text-foreground">
										AGPLv3
									</span>
									<span className="text-muted-foreground">open source</span>
								</li>
							</ul>
						</div>
					</div>
				</section>

				{/* At-a-glance matrix */}
				<section className="border-b border-border/60">
					<div className="container mx-auto px-4 py-14 md:py-20">
						<div className="mx-auto mb-8 max-w-3xl space-y-3 text-center">
							<h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
								Every alternative at a glance
							</h2>
							<p className="text-sm text-muted-foreground md:text-base">
								Licensing and hosting are what separate these products fastest.
								Everything else — routing, pricing, model coverage — is covered
								in each deep dive.
							</p>
						</div>

						<div className="overflow-x-auto rounded-xl border border-border/60">
							<table className="w-full min-w-[46rem] border-collapse text-left text-sm">
								<caption className="sr-only">
									LLM Gateway compared with seven alternatives by open-source
									licensing and self-hosting
								</caption>
								<thead>
									<tr className="border-b border-border/60 bg-muted/40">
										<th scope="col" className="px-4 py-3 font-semibold">
											Product
										</th>
										<th scope="col" className="px-4 py-3 font-semibold">
											Category
										</th>
										<th scope="col" className="px-4 py-3 font-semibold">
											Open source
										</th>
										<th scope="col" className="px-4 py-3 font-semibold">
											Self-hostable
										</th>
										<th scope="col" className="px-4 py-3 font-semibold">
											Deep dive
										</th>
									</tr>
								</thead>
								<tbody>
									<tr className="border-b border-border/60 bg-sky-500/5">
										<th
											scope="row"
											className="px-4 py-3 font-semibold text-foreground"
										>
											LLM Gateway
										</th>
										<td className="px-4 py-3 text-muted-foreground">
											AI gateways &amp; routers
										</td>
										<td className="px-4 py-3 text-muted-foreground">
											Full platform (AGPLv3)
										</td>
										<td className="px-4 py-3 text-muted-foreground">Yes</td>
										<td className="px-4 py-3 text-muted-foreground">—</td>
									</tr>
									{comparisons.map((comparison) => (
										<tr
											key={comparison.slug}
											className="border-b border-border/60 last:border-0"
										>
											<th
												scope="row"
												className="px-4 py-3 font-medium text-foreground"
											>
												<span className="flex items-center gap-2.5">
													<CompetitorIcon slug={comparison.slug} />
													{comparison.competitor}
												</span>
											</th>
											<td className="px-4 py-3 text-muted-foreground">
												{comparison.category}
											</td>
											<td className="px-4 py-3 text-muted-foreground">
												{comparison.openSource}
											</td>
											<td className="px-4 py-3 text-muted-foreground">
												{comparison.selfHostable}
											</td>
											<td className="px-4 py-3">
												<Link
													href={`/compare/${comparison.slug}` as Route}
													className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
												>
													Compare
													<ArrowUpRight className="h-3.5 w-3.5" />
												</Link>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</section>

				{/* Comparison cards, grouped by category */}
				<section className="border-b border-border/60">
					<div className="container mx-auto space-y-14 px-4 py-14 md:py-20">
						{comparisonCategories.map((category) => (
							<div key={category} className="space-y-6">
								<h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
									{category}
								</h2>
								<div className="grid gap-5 md:grid-cols-2">
									{comparisonsByCategory(category).map((comparison) => (
										<article
											key={comparison.slug}
											className="group relative flex flex-col rounded-xl border border-border/60 bg-card p-6 transition-colors hover:border-foreground/20"
										>
											<div className="mb-4 flex items-center gap-3">
												<span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
													<CompetitorIcon slug={comparison.slug} />
												</span>
												<h3 className="font-display text-lg font-semibold">
													<Link
														href={`/compare/${comparison.slug}` as Route}
														className="after:absolute after:inset-0"
													>
														LLM Gateway vs {comparison.competitor}
													</Link>
												</h3>
											</div>

											<dl className="flex-grow space-y-3 text-sm">
												<div>
													<dt className="font-medium text-foreground">
														What {comparison.competitor} is
													</dt>
													<dd className="mt-1 leading-relaxed text-muted-foreground">
														{comparison.positioning}
													</dd>
												</div>
												<div>
													<dt className="font-medium text-foreground">
														Where LLM Gateway differs
													</dt>
													<dd className="mt-1 leading-relaxed text-muted-foreground">
														{comparison.keyDifference}
													</dd>
												</div>
												<div>
													<dt className="font-medium text-foreground">
														Pick {comparison.competitor} if
													</dt>
													<dd className="mt-1 leading-relaxed text-muted-foreground">
														{comparison.betterForThem}
													</dd>
												</div>
											</dl>

											<div className="mt-5 flex items-center gap-4 text-sm font-medium">
												<span className="inline-flex items-center gap-1 text-foreground">
													Read the comparison
													<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
												</span>
												{comparison.migrationSlug ? (
													<Link
														href={
															`/migration/${comparison.migrationSlug}` as Route
														}
														className="relative z-10 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
													>
														Migration guide
													</Link>
												) : null}
											</div>
										</article>
									))}
								</div>
							</div>
						))}
					</div>
				</section>

				{/* Honest guidance */}
				<section className="border-b border-border/60">
					<div className="container mx-auto px-4 py-14 md:py-20">
						<div className="mx-auto max-w-3xl space-y-5">
							<h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
								Which one should you choose?
							</h2>
							<p className="text-sm leading-relaxed text-muted-foreground md:text-base">
								If you need one endpoint across many providers, want the routing
								layer to be inspectable and self-hostable, and care about paying
								provider rates rather than a marked-up bill, LLM Gateway is
								built for that. If your models all live in one cloud you are
								already committed to, that cloud's own platform is the shorter
								path — and LLM Gateway can still sit in front of it with your
								own keys at 0% markup.
							</p>
							<p className="text-sm leading-relaxed text-muted-foreground md:text-base">
								The comparisons above are written to help you rule LLM Gateway{" "}
								<em>out</em> as readily as in. Each one names what the other
								product does better.
							</p>
						</div>
					</div>
				</section>

				{/* FAQ — rendered in full so crawlers and answer engines can read it */}
				<section className="border-b border-border/60" id="faq">
					<div className="container mx-auto px-4 py-14 md:py-20">
						<div className="mx-auto max-w-3xl">
							<h2 className="mb-8 font-display text-2xl font-bold tracking-tight md:text-3xl">
								Choosing an AI gateway, answered
							</h2>
							<dl className="divide-y divide-border/60">
								{faqs.map((faq) => (
									<div key={faq.question} className="py-5">
										<dt className="font-display text-base font-semibold md:text-lg">
											{faq.question}
										</dt>
										<dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
											{faq.answer}
										</dd>
									</div>
								))}
							</dl>
						</div>
					</div>
				</section>

				<section>
					<div className="container mx-auto px-4 py-14 md:py-20">
						<div className="mx-auto max-w-2xl space-y-5 text-center">
							<h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
								Try it against your own workload
							</h2>
							<p className="text-sm text-muted-foreground md:text-base">
								Change the base URL and API key, send a request, and compare the
								numbers yourself.
							</p>
							<div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
								<Button asChild size="lg" className="rounded-xl">
									<AuthLink href="/signup">Start for free</AuthLink>
								</Button>
								<Button
									asChild
									size="lg"
									variant="ghost"
									className="rounded-xl"
								>
									<Link href="/migration">Browse migration guides</Link>
								</Button>
							</div>
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</>
	);
}
