import { ArrowRight } from "lucide-react";
import Link from "next/link";

import s from "@/components/features/visuals/visuals.module.css";
import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { Button } from "@/lib/components/button";
import { featureCategories, features } from "@/lib/features";
import { cn } from "@/lib/utils";

import type { Metadata } from "next";
import type { CSSProperties } from "react";

export const metadata: Metadata = {
	title: "Features",
	description:
		"Every LLM Gateway feature in one place: routing and fallback, image, video and audio APIs, cost tracking, compliance, SSO and more.",
	alternates: { canonical: "/features" },
	openGraph: {
		title: "LLM Gateway Features",
		description:
			"Routing, multimodal APIs, observability, governance and payments behind one OpenAI-compatible API.",
		type: "website",
		url: "https://llmgateway.io/features",
		images: ["/opengraph.png"],
	},
};

const HERO_COLUMNS = 7;
const heroTiles = features.slice(
	0,
	features.length - (features.length % HERO_COLUMNS),
);

const sections = featureCategories.map((category) => ({
	...category,
	items: features.filter((feature) => feature.category === category.id),
}));

export default function FeaturesPage() {
	return (
		<>
			<Navbar />
			<main className="min-h-screen bg-background">
				<section className="relative overflow-hidden border-b border-border">
					<div
						className={cn(
							s.dotGrid,
							"pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]",
						)}
					/>
					<div className="container relative grid items-center gap-12 lg:grid-cols-2 mx-auto px-4 pb-14 pt-32 md:pb-20 md:pt-40">
						<div>
							<p className="animate-hero-enter font-mono text-sm text-muted-foreground">
								{features.length} features · one API
							</p>
							<h1 className="animate-hero-enter hero-enter-delay-1 mt-4 max-w-3xl text-balance font-display text-4xl font-bold tracking-tight md:text-6xl">
								Everything the gateway does
							</h1>
							<nav
								aria-label="Feature categories"
								className="animate-hero-enter hero-enter-delay-2 mt-10 flex flex-wrap gap-2"
							>
								{sections.map((section) => (
									<a
										key={section.id}
										href={`#${section.id}`}
										style={{ "--fa": section.accent } as CSSProperties}
										className="group inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-4 py-2 text-sm font-medium transition-[border-color,transform] duration-200 hover:border-[var(--fa)] active:scale-[0.97]"
									>
										<span className="size-2 rounded-full bg-[var(--fa)]" />
										{section.label}
										<span className="font-mono text-xs text-muted-foreground">
											{section.items.length}
										</span>
									</a>
								))}
							</nav>
						</div>
						<div
							aria-hidden
							className="animate-hero-enter hero-enter-delay-2 grid w-full max-w-xl grid-cols-7 gap-2 lg:ml-auto"
						>
							{heroTiles.map((feature, index) => {
								const Icon = feature.icon;
								const accent = featureCategories.find(
									(category) => category.id === feature.category,
								)?.accent;
								return (
									<Link
										key={feature.slug}
										href={`/features/${feature.slug}`}
										tabIndex={-1}
										title={feature.title}
										style={
											{ "--fa": accent, "--i": index % 16 } as CSSProperties
										}
										className={cn(
											s.pop,
											"group flex aspect-square items-center justify-center rounded-xl border border-border bg-card transition-[border-color,background-color] duration-200 hover:border-[var(--fa)] hover:bg-[color-mix(in_oklab,var(--fa)_12%,transparent)]",
										)}
									>
										<Icon
											className={cn(
												s.float,
												"size-5 text-[var(--fa)] opacity-80 transition-opacity group-hover:opacity-100",
											)}
										/>
									</Link>
								);
							})}
						</div>
					</div>
				</section>

				<div className="container mx-auto px-4">
					{sections.map((section) => (
						<section
							key={section.id}
							id={section.id}
							className="scroll-mt-24 border-b border-border py-16 last:border-0 md:py-20"
							style={{ "--fa": section.accent } as CSSProperties}
						>
							<div className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
								<h2 className="flex items-center gap-3 font-display text-2xl font-bold tracking-tight md:text-3xl">
									<span className="size-3 rounded-full bg-[var(--fa)] shadow-[0_0_0_5px_color-mix(in_oklab,var(--fa)_18%,transparent)]" />
									{section.label}
								</h2>
								<p className="text-muted-foreground">{section.tagline}</p>
							</div>
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
								{section.items.map((feature) => {
									const Icon = feature.icon;
									return (
										<Link
											key={feature.slug}
											href={`/features/${feature.slug}`}
											className={cn(
												s.lift,
												"scroll-reveal group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5 hover:border-[color-mix(in_oklab,var(--fa)_45%,var(--border))] hover:shadow-md",
											)}
										>
											<div className="flex items-start justify-between">
												<span className="flex size-10 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--fa)_12%,transparent)] transition-transform duration-200 group-hover:scale-105">
													<Icon className="size-5 text-[var(--fa)]" />
												</span>
												{feature.enterprise && (
													<span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
														Enterprise
													</span>
												)}
											</div>
											<div>
												<h3 className="font-semibold tracking-tight">
													{feature.title}
												</h3>
												<p className="mt-1 text-sm text-muted-foreground">
													{feature.subtitle}
												</p>
											</div>
											<ArrowRight className="mt-auto h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1 group-hover:text-foreground" />
										</Link>
									);
								})}
							</div>
						</section>
					))}

					<section className="scroll-reveal py-20 text-center">
						<h2 className="text-balance font-display text-3xl font-bold tracking-tight md:text-4xl">
							All of it, behind one API key
						</h2>
						<div className="mt-8 flex flex-wrap justify-center gap-3">
							<Button
								asChild
								size="lg"
								className="group gap-2 active:scale-[0.97]"
							>
								<Link href="/signup">
									Get started
									<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</Button>
							<Button
								asChild
								variant="outline"
								size="lg"
								className="active:scale-[0.97]"
							>
								<Link href="/models">Browse models</Link>
							</Button>
						</div>
					</section>
				</div>
			</main>
			<Footer />
		</>
	);
}
