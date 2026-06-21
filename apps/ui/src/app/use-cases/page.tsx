import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

import { allUseCases } from "content-collections";

import type { UseCase } from "content-collections";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Use Cases — What You Can Build with LLM Gateway",
	description:
		"Coding agents, AI customer support, RAG and document Q&A, and AI cost optimization — see how teams build on LLM Gateway's one API for 280+ models, with fallback, caching and analytics.",
	alternates: { canonical: "/use-cases" },
	openGraph: {
		title: "Use Cases — What You Can Build with LLM Gateway",
		description:
			"Coding agents, AI customer support, RAG, and cost optimization on one API for 280+ models with fallback, caching and analytics.",
		type: "website",
		url: "https://llmgateway.io/use-cases",
		images: ["/opengraph.png"],
	},
};

export default function UseCasesIndexPage() {
	const entries = allUseCases
		.filter((entry: UseCase) => !entry.draft)
		.sort(
			(a: UseCase, b: UseCase) =>
				new Date(b.date).getTime() - new Date(a.date).getTime(),
		);

	return (
		<>
			<HeroRSC navbarOnly />
			<div className="min-h-screen bg-background text-foreground pt-30">
				<main className="container mx-auto px-4 py-8">
					<div className="mx-auto max-w-5xl">
						<header className="mb-12 max-w-2xl">
							<p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
								Use cases
							</p>
							<h1 className="text-4xl font-bold tracking-tight md:text-5xl">
								What you can build with LLM Gateway
							</h1>
							<p className="mt-4 text-lg leading-relaxed text-muted-foreground">
								One OpenAI-compatible API for 280+ models — with automatic
								fallback, prompt caching, and per-request cost analytics.
								Here&apos;s what teams build on it.
							</p>
						</header>

						<div className="grid gap-6 sm:grid-cols-2">
							{entries.map((entry: UseCase) => (
								<Link
									key={entry.id}
									href={`/use-cases/${entry.slug}`}
									className="group flex flex-col rounded-2xl border border-border bg-card p-7 transition-colors hover:border-foreground/30"
								>
									<h2 className="text-xl font-semibold text-foreground">
										{entry.title}
									</h2>
									<p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
										{entry.summary}
									</p>
									<div className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
										Read more
										<ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
									</div>
								</Link>
							))}
						</div>
					</div>
				</main>
				<Footer />
			</div>
		</>
	);
}
