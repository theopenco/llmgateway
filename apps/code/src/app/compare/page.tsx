import { ArrowRight, Scale } from "lucide-react";
import Link from "next/link";

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

import { allComparisons } from "content-collections";

import type { Comparison } from "content-collections";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "DevPass vs the Alternatives — Coding Plan Comparisons",
	description:
		"How DevPass compares to OpenCode Go, OpenCode Zen, FirePass, the z.ai GLM Coding Plan, and Alibaba's Qwen plan. Pricing, model catalogs, and limits side by side.",
	alternates: { canonical: "/compare" },
	openGraph: {
		title: "DevPass vs the Alternatives — Coding Plan Comparisons",
		description:
			"How DevPass compares to OpenCode Go, OpenCode Zen, FirePass, z.ai and Alibaba Qwen. Pricing, models, and limits side by side.",
		type: "website",
		url: "https://devpass.llmgateway.io/compare",
	},
};

export default function CompareIndexPage() {
	const entries = allComparisons
		.filter((entry: Comparison) => !entry.draft)
		.sort((a: Comparison, b: Comparison) =>
			a.competitor.localeCompare(b.competitor),
		);

	return (
		<div className="min-h-screen bg-background">
			<Header />

			<main>
				<section className="relative overflow-hidden border-b">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-muted/60 via-transparent to-transparent" />
					<div className="container relative mx-auto max-w-4xl px-4 pt-20 pb-12 sm:pt-24 text-center">
						<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
							<Scale className="h-3.5 w-3.5" />
							Comparisons
						</div>
						<h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
							DevPass vs the alternatives
						</h1>
						<p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
							Single-vendor plans and single-model deals each do one thing well.
							DevPass gives you all 200+ models — frontier and open-weight —
							under one key. Here&apos;s how it stacks up.
						</p>
					</div>
				</section>

				<section className="px-4 py-12">
					<div className="container mx-auto max-w-4xl">
						<div className="grid gap-5 sm:grid-cols-2">
							{entries.map((entry: Comparison) => (
								<Link
									key={entry.id}
									href={`/compare/${entry.slug}`}
									className="group flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-colors hover:border-foreground/30"
								>
									<div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
										<span className="text-foreground">DevPass</span>
										<span className="text-muted-foreground/50">vs</span>
										<span>{entry.competitor}</span>
									</div>
									<p className="flex-1 text-sm leading-6 text-muted-foreground">
										{entry.verdict}
									</p>
									<div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
										Read the comparison
										<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
									</div>
								</Link>
							))}
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
