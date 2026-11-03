import { ArrowLeft, ArrowRight, Layers, Scale } from "lucide-react";
import Link from "next/link";

import { FaceOff, ThemTile, UsTile } from "@/components/compare/logo-faceoff";
import { Button } from "@/components/ui/button";
import {
	comparisons,
	STUDIO_ORDER,
	STUDIOS,
	studioOf,
	US,
} from "@/lib/comparisons";
import { pageTitle } from "@/lib/page-title";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: pageTitle("Compare Lounge vs ChatGPT, Higgsfield, ElevenLabs & more"),
	description:
		"Compare Lounge's chat, video, image, audio, voice and decision studios to ChatGPT, Claude, Higgsfield, fal, ElevenLabs, Midjourney and more, with model prices side by side.",
	alternates: { canonical: "/compare" },
	openGraph: {
		title: "Compare Lounge — vs ChatGPT, Claude, Gemini & more",
		description:
			"One subscription, every frontier model. See how Lounge stacks up against the AI chat apps you're evaluating.",
		type: "website",
		url: "https://lounge.llmgateway.io/compare",
	},
	twitter: {
		card: "summary_large_image",
		title: "Compare Lounge — vs ChatGPT, Claude, Gemini & more",
		description:
			"One subscription, every frontier model. See how Lounge stacks up against the AI chat apps you're evaluating.",
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
	const chatEntries = comparisons.filter(
		(c) => (c.studio ?? "chat") === "chat",
	);
	const grouped = [
		...categoryOrder.map((category) => ({
			id: `chat-${category}`,
			label: `Chat · ${categoryLabels[category]}`,
			entries: chatEntries.filter((c) => c.category === category),
		})),
		...STUDIO_ORDER.filter((studio) => studio !== "chat").map((studio) => ({
			id: studio,
			label: STUDIOS[studio].label,
			entries: comparisons.filter((c) => c.studio === studio),
		})),
	].filter((group) => group.entries.length > 0);
	const studioLinks = STUDIO_ORDER.filter((studio) =>
		comparisons.some((c) => (c.studio ?? "chat") === studio),
	).map((studio) => ({
		studio,
		label: STUDIOS[studio].label,
		href: studio === "chat" ? `#chat-${categoryOrder[0]}` : `#${studio}`,
	}));

	const itemListSchema = {
		"@context": "https://schema.org",
		"@type": "ItemList",
		name: "Lounge comparisons",
		itemListElement: comparisons.map((c, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: `${studioOf(c).product} vs ${c.competitor}`,
			url: `https://lounge.llmgateway.io/compare/${c.slug}`,
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
							Compare Lounge
						</h1>
						<p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
							Most AI apps lock you into one model family, or one confusing
							credit system. Lounge runs {US.modelCount} models across chat,
							video, image, audio, voice calls and decisions, on one balance at
							provider rates. Here&apos;s how each studio stacks up.
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

						<nav
							aria-label="Jump to a studio"
							className="mt-8 flex flex-wrap justify-center gap-2"
						>
							{studioLinks.map((link) => (
								<a
									key={link.studio}
									href={link.href}
									className="rounded-full border bg-background px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
								>
									{link.label}
								</a>
							))}
						</nav>

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
						<div key={group.id} id={group.id} className="scroll-mt-20">
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
											{studioOf(entry).product} vs {entry.competitor}
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
							credit system versus{" "}
							<span className="font-medium text-foreground">
								one balance for {US.modelCount} models
							</span>{" "}
							at provider rates. Studio pages put each model&apos;s price next
							to the competitor&apos;s, with the source and date.
						</p>
					</div>
				</div>
			</section>
		</main>
	);
}
