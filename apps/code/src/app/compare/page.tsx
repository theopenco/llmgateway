import { ArrowRight, Layers, Scale } from "lucide-react";
import Link from "next/link";

import { BrandTile } from "@/components/brand-logos";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

import { allComparisons } from "content-collections";

import type { Comparison } from "content-collections";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "DevPass vs the Alternatives — Coding Plan Comparisons",
	description:
		"How DevPass compares to Cursor, OpenCode, FirePass, the z.ai GLM Coding Plan, and Alibaba's Qwen plan. Pricing, model catalogs, and limits side by side.",
	alternates: { canonical: "/compare" },
	openGraph: {
		title: "DevPass vs the Alternatives — Coding Plan Comparisons",
		description:
			"How DevPass compares to Cursor, OpenCode, FirePass, z.ai and Alibaba Qwen. Pricing, models, and limits side by side.",
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
				{/* Hero */}
				<section className="relative overflow-hidden border-b">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_-10%,_var(--tw-gradient-stops))] from-muted/70 via-transparent to-transparent" />
					<div
						className="pointer-events-none absolute inset-0 opacity-[0.04]"
						style={{
							backgroundImage:
								"linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
							backgroundSize: "44px 44px",
							maskImage:
								"radial-gradient(ellipse 70% 60% at 50% 0%, black, transparent)",
						}}
					/>
					<div className="container relative mx-auto max-w-4xl px-4 pt-20 pb-14 text-center sm:pt-24">
						<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
							<Scale className="h-3.5 w-3.5" />
							Comparisons
						</div>
						<h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
							DevPass vs the alternatives
						</h1>
						<p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
							Single-vendor plans and single-model deals each do one thing well.
							DevPass gives you all 280+ models — frontier and open-weight —
							under one key. Here&apos;s how it stacks up.
						</p>

						{/* Logo lineup */}
						<div className="mt-10 flex flex-wrap items-center justify-center gap-3">
							<BrandTile brand="devpass" size={44} radius={12} />
							<span className="px-1 text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground/70">
								vs
							</span>
							{entries.map((entry: Comparison) => (
								<BrandTile
									key={entry.id}
									brand={entry.competitorLogo ?? entry.competitor}
									size={44}
									radius={12}
								/>
							))}
						</div>
					</div>
				</section>

				{/* Cards */}
				<section className="px-4 py-14">
					<div className="container mx-auto max-w-4xl">
						<div className="grid gap-5 sm:grid-cols-2">
							{entries.map((entry: Comparison, idx: number) => (
								<Link
									key={entry.id}
									href={`/compare/${entry.slug}`}
									className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-both"
									style={{ animationDelay: `${idx * 70}ms` }}
								>
									{/* Logo face-off */}
									<div className="mb-5 flex items-center gap-3">
										<BrandTile brand="devpass" size={40} radius={11} />
										<span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">
											vs
										</span>
										<BrandTile
											brand={entry.competitorLogo ?? entry.competitor}
											size={40}
											radius={11}
										/>
									</div>

									<h2 className="text-lg font-semibold tracking-tight text-foreground">
										DevPass vs {entry.competitor}
									</h2>
									<p className="mt-1 text-xs font-medium text-muted-foreground">
										{entry.competitorTagline}
									</p>

									<p className="mt-4 flex-1 text-sm leading-6 text-muted-foreground line-clamp-3">
										{entry.verdict}
									</p>

									{/* Price compare strip */}
									<div className="mt-5 flex items-center gap-2 text-[11px] font-medium">
										<span className="rounded-md bg-muted px-2 py-1 font-mono tabular-nums text-foreground">
											{entry.devpassPrice}
										</span>
										<span className="text-muted-foreground/50">vs</span>
										<span className="rounded-md bg-muted px-2 py-1 font-mono tabular-nums text-muted-foreground">
											{entry.competitorPrice}
										</span>
									</div>

									<div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
										Read the comparison
										<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
									</div>
								</Link>
							))}
						</div>

						{/* Catalog note */}
						<div className="mt-10 flex items-start gap-3 rounded-2xl border border-dashed bg-muted/30 p-5 text-sm text-muted-foreground">
							<Layers className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
							<p>
								Every comparison weighs the same trade: a single-vendor or
								single-tool plan versus{" "}
								<span className="font-medium text-foreground">
									one key to 280+ models
								</span>{" "}
								at provider rates, with a per-request cost dashboard and
								commercial use on every tier.
							</p>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
