import { ArrowLeft, ArrowRight, Layers, Scale } from "lucide-react";
import Link from "next/link";

import { FaceOff, ThemTile, UsTile } from "@/components/compare/logo-faceoff";
import { Button } from "@/components/ui/button";
import { comparisons, US } from "@/lib/comparisons";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Compare LLM Gateway Chat — vs ChatGPT, Claude, Gemini & more",
	description:
		"Compare LLM Gateway Chat to ChatGPT, Claude, Gemini, Poe, Perplexity and OpenRouter — every frontier model on one $19/mo subscription.",
	alternates: { canonical: "/compare" },
	openGraph: {
		title: "Compare LLM Gateway Chat — vs ChatGPT, Claude, Gemini & more",
		description:
			"One subscription, every frontier model. See how LLM Gateway Chat stacks up against the AI chat apps you're evaluating.",
		type: "website",
		url: "https://chat.llmgateway.io/compare",
	},
	twitter: {
		card: "summary_large_image",
		title: "Compare LLM Gateway Chat — vs ChatGPT, Claude, Gemini & more",
		description:
			"One subscription, every frontier model. See how LLM Gateway Chat stacks up against the AI chat apps you're evaluating.",
	},
};

const categoryLabels: Record<string, string> = {
	"single-vendor": "Single-vendor assistants",
	aggregator: "Multi-model apps",
	"answer-engine": "Answer engines",
	developer: "Developer tools",
};

const categoryOrder = [
	"single-vendor",
	"aggregator",
	"answer-engine",
	"developer",
] as const;

export default function CompareIndexPage() {
	const grouped = categoryOrder
		.map((category) => ({
			category,
			label: categoryLabels[category],
			entries: comparisons.filter((c) => c.category === category),
		}))
		.filter((group) => group.entries.length > 0);

	const itemListSchema = {
		"@context": "https://schema.org",
		"@type": "ItemList",
		name: "LLM Gateway Chat comparisons",
		itemListElement: comparisons.map((c, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: `LLM Gateway Chat vs ${c.competitor}`,
			url: `https://chat.llmgateway.io/compare/${c.slug}`,
		})),
	};

	return (
		<main>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }}
			/>
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
				<div className="relative mx-auto max-w-4xl px-4 pt-14 pb-14 sm:pt-20">
					<Link
						href="/"
						className="mb-10 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
					>
						<ArrowLeft className="h-4 w-4" />
						Back to chat
					</Link>
					<div className="text-center">
						<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
							<Scale className="h-3.5 w-3.5" />
							Comparisons
						</div>
						<h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
							Compare LLM Gateway Chat
						</h1>
						<p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
							Most AI chat apps lock you into one model family — or one
							confusing billing system. LLM Gateway Chat gives you{" "}
							{US.modelCount} models, frontier and open, on one subscription.
							Here&apos;s how it stacks up.
						</p>

						{/* Logo lineup */}
						<div className="mt-10 flex flex-wrap items-center justify-center gap-3">
							<UsTile size={44} radius={12} />
							<span className="px-1 text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground/70">
								vs
							</span>
							{comparisons.map((entry) => (
								<ThemTile
									key={entry.slug}
									slug={entry.slug}
									competitor={entry.competitor}
									size={44}
									radius={12}
								/>
							))}
						</div>

						<div className="mt-10 flex justify-center gap-3">
							<Button asChild size="lg">
								<Link href="/">
									Start chatting free
									<ArrowRight className="ml-1.5 h-4 w-4" />
								</Link>
							</Button>
							<Button asChild size="lg" variant="outline">
								<Link href="/pricing">See plans</Link>
							</Button>
						</div>
					</div>
				</div>
			</section>

			{/* Grouped cards */}
			<section className="px-4 py-14">
				<div className="mx-auto max-w-4xl space-y-12">
					{grouped.map((group) => (
						<div key={group.category}>
							<h2 className="mb-5 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
								{group.label}
							</h2>
							<div className="grid gap-5 sm:grid-cols-2">
								{group.entries.map((entry) => (
									<Link
										key={entry.slug}
										href={`/compare/${entry.slug}`}
										className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-lg"
									>
										<div className="mb-5">
											<FaceOff
												slug={entry.slug}
												competitor={entry.competitor}
												size={40}
												radius={11}
											/>
										</div>

										<h3 className="text-lg font-semibold tracking-tight text-foreground">
											LLM Gateway Chat vs {entry.competitor}
										</h3>
										<p className="mt-1 text-xs font-medium text-muted-foreground">
											{entry.competitorTagline}
										</p>

										<p className="mt-4 flex-1 text-sm leading-6 text-muted-foreground line-clamp-3">
											{entry.verdict}
										</p>

										<div className="mt-5 flex items-center gap-2 text-[11px] font-medium">
											<span className="rounded-md bg-foreground px-2 py-1 font-mono tabular-nums text-background">
												{entry.usPrice}
											</span>
											<span className="text-muted-foreground/50">vs</span>
											<span className="rounded-md bg-muted px-2 py-1 font-mono tabular-nums text-muted-foreground">
												{entry.themPrice}
											</span>
										</div>

										<div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
											Read the comparison
											<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
										</div>
									</Link>
								))}
							</div>
						</div>
					))}

					{/* Catalog note */}
					<div className="flex items-start gap-3 rounded-2xl border border-dashed bg-muted/30 p-5 text-sm text-muted-foreground">
						<Layers className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
						<p>
							Every comparison weighs the same trade: a single-vendor plan or a
							confusing points system versus{" "}
							<span className="font-medium text-foreground">
								one balance for {US.modelCount} models
							</span>{" "}
							at provider rates, with per-message cost shown plainly and image,
							video, and audio generation built in.
						</p>
					</div>
				</div>
			</section>
		</main>
	);
}
