import { ArrowLeft, ArrowRight, Check, Minus, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ComparisonTable } from "@/components/compare/comparison-table";
import { FaceOff, ThemTile, UsTile } from "@/components/compare/logo-faceoff";
import { Button } from "@/components/ui/button";
import {
	comparisons,
	getComparison,
	getComparisonSlugs,
	US,
} from "@/lib/comparisons";

import type { Metadata } from "next";

interface PageProps {
	params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
	return getComparisonSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { slug } = await params;
	const comparison = getComparison(slug);
	if (!comparison) {
		return {};
	}
	const canonical = `/compare/${comparison.slug}`;
	return {
		title: comparison.metaTitle,
		description: comparison.metaDescription,
		alternates: { canonical },
		openGraph: {
			title: comparison.metaTitle,
			description: comparison.metaDescription,
			type: "article",
			url: `https://chat.llmgateway.io${canonical}`,
		},
		twitter: {
			card: "summary_large_image",
			title: comparison.metaTitle,
			description: comparison.metaDescription,
		},
	};
}

export default async function ComparePage({ params }: PageProps) {
	const { slug } = await params;
	const comparison = getComparison(slug);
	if (!comparison) {
		notFound();
	}

	const others = comparisons.filter((c) => c.slug !== comparison.slug);

	const faqSchema = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: comparison.faq.map((item) => ({
			"@type": "Question",
			name: item.q,
			acceptedAnswer: { "@type": "Answer", text: item.a },
		})),
	};

	const breadcrumbSchema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{
				"@type": "ListItem",
				position: 1,
				name: "Compare",
				item: "https://chat.llmgateway.io/compare",
			},
			{
				"@type": "ListItem",
				position: 2,
				name: `LLM Gateway Chat vs ${comparison.competitor}`,
				item: `https://chat.llmgateway.io/compare/${comparison.slug}`,
			},
		],
	};

	return (
		<main className="mx-auto max-w-4xl px-4 py-14 sm:py-20">
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
			/>

			<div className="mb-8 flex items-center justify-between">
				<Link
					href="/compare"
					className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					All comparisons
				</Link>
				<Link
					href="/"
					className="text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					Back to chat
				</Link>
			</div>

			{/* Hero */}
			<header>
				<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground">
					<Sparkles className="h-3.5 w-3.5" />
					{comparison.eyebrow}
				</div>
				<div className="mb-6">
					<FaceOff
						slug={comparison.slug}
						competitor={comparison.competitor}
						size={52}
						radius={14}
					/>
				</div>
				<h1 className="text-3xl font-bold tracking-tight text-balance sm:text-5xl">
					LLM Gateway Chat vs {comparison.competitor}
				</h1>
				<p className="mt-3 text-base font-medium text-muted-foreground">
					{comparison.competitorTagline}
				</p>

				{/* TL;DR */}
				<div className="mt-7 rounded-2xl border border-dashed bg-muted/30 p-5 sm:p-6">
					<div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						TL;DR
					</div>
					<p className="text-pretty leading-relaxed text-foreground">
						{comparison.verdict}
					</p>
				</div>

				{/* Price strip + CTAs */}
				<div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2 text-sm font-medium">
						<span className="rounded-md bg-foreground px-2.5 py-1 font-mono tabular-nums text-background">
							{comparison.usPrice}
						</span>
						<span className="text-muted-foreground/50">vs</span>
						<span className="rounded-md bg-muted px-2.5 py-1 font-mono tabular-nums text-muted-foreground">
							{comparison.themPrice}
						</span>
					</div>
					<div className="flex gap-3">
						<Button asChild>
							<Link href="/">
								Start chatting free
								<ArrowRight className="ml-1.5 h-4 w-4" />
							</Link>
						</Button>
						<Button asChild variant="outline">
							<Link href="/pricing">See plans</Link>
						</Button>
					</div>
				</div>
			</header>

			{/* At a glance */}
			<section className="mt-16">
				<h2 className="mb-5 text-xl font-semibold tracking-tight">
					LLM Gateway Chat vs {comparison.competitor} at a glance
				</h2>
				<ComparisonTable
					competitor={comparison.competitor}
					slug={comparison.slug}
					rows={comparison.table}
				/>
			</section>

			{/* Deep sections */}
			<section className="mt-16 space-y-10">
				<h2 className="text-xl font-semibold tracking-tight">
					How they compare, in depth
				</h2>
				{comparison.sections.map((section) => (
					<div key={section.heading}>
						<h3 className="text-lg font-semibold">{section.heading}</h3>
						<div className="mt-4 grid gap-4 sm:grid-cols-2">
							<div className="rounded-xl border bg-card p-5">
								<div className="mb-2 flex items-center gap-2 text-sm font-semibold">
									<UsTile size={22} radius={6} />
									LLM Gateway Chat
								</div>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{section.us}
								</p>
							</div>
							<div className="rounded-xl border bg-card p-5">
								<div className="mb-2 flex items-center gap-2 text-sm font-semibold">
									<ThemTile
										slug={comparison.slug}
										competitor={comparison.competitor}
										size={22}
										radius={6}
									/>
									{comparison.competitor}
								</div>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{section.them}
								</p>
							</div>
						</div>
						<p className="mt-3 text-sm font-medium text-foreground/80">
							<span className="text-muted-foreground">Bottom line: </span>
							{section.bottomLine}
						</p>
					</div>
				))}
			</section>

			{/* Who should choose what */}
			<section className="mt-16 grid gap-5 sm:grid-cols-2">
				<div className="rounded-2xl border bg-card p-6">
					<div className="mb-4 flex items-center gap-2.5">
						<ThemTile
							slug={comparison.slug}
							competitor={comparison.competitor}
							size={28}
							radius={8}
						/>
						<h2 className="text-lg font-semibold">
							Choose {comparison.competitor} if
						</h2>
					</div>
					<ul className="space-y-3">
						{comparison.chooseThem.map((item) => (
							<li key={item} className="flex items-start gap-2.5 text-sm">
								<Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
								<span className="text-muted-foreground">{item}</span>
							</li>
						))}
					</ul>
				</div>
				<div className="rounded-2xl border border-foreground/20 bg-card p-6 shadow-sm ring-1 ring-foreground/5">
					<div className="mb-4 flex items-center gap-2.5">
						<UsTile size={28} radius={8} />
						<h2 className="text-lg font-semibold">
							Choose LLM Gateway Chat if
						</h2>
					</div>
					<ul className="space-y-3">
						{comparison.chooseUs.map((item) => (
							<li key={item} className="flex items-start gap-2.5 text-sm">
								<Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
								<span className="text-foreground">{item}</span>
							</li>
						))}
					</ul>
				</div>
			</section>

			{/* Alternative intent */}
			<section className="mt-16 rounded-2xl border bg-muted/30 p-6 sm:p-8">
				<h2 className="text-xl font-semibold tracking-tight">
					{comparison.switchHeading}
				</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					You might be here because:
				</p>
				<ul className="mt-4 grid gap-3 sm:grid-cols-2">
					{comparison.whySwitch.map((item) => (
						<li key={item} className="flex items-start gap-2.5 text-sm">
							<ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-foreground/60" />
							<span className="text-foreground">{item}</span>
						</li>
					))}
				</ul>
				<div className="mt-6 border-t border-border/60 pt-5">
					<h3 className="text-sm font-semibold">Switching is easy</h3>
					<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
						{comparison.migration}
					</p>
				</div>
			</section>

			{/* Pricing recap */}
			<section className="mt-16">
				<h2 className="mb-5 text-xl font-semibold tracking-tight">
					One subscription, up to 3× the credits
				</h2>
				<div className="grid gap-4 sm:grid-cols-3">
					{(
						[
							{ name: "Starter", ...US.plans.starter, note: "Most models" },
							{
								name: "Plus",
								...US.plans.plus,
								note: "Every frontier model",
								popular: true,
							},
							{ name: "Pro", ...US.plans.pro, note: "Best value at volume" },
						] as const
					).map((plan) => (
						<div
							key={plan.name}
							className={`rounded-2xl border bg-card p-5 ${
								"popular" in plan && plan.popular
									? "border-foreground/30 ring-1 ring-foreground/10"
									: ""
							}`}
						>
							<div className="flex items-baseline justify-between">
								<span className="text-sm font-semibold">{plan.name}</span>
								<span className="rounded-full bg-foreground/90 px-2 py-0.5 text-[10px] font-bold tabular-nums text-background">
									{plan.multiplier}× value
								</span>
							</div>
							<div className="mt-2 flex items-baseline gap-1">
								<span className="text-3xl font-bold tabular-nums">
									${plan.price}
								</span>
								<span className="text-sm text-muted-foreground">/mo</span>
							</div>
							<p className="mt-1 text-xs text-muted-foreground tabular-nums">
								$
								{Number.isInteger(plan.value)
									? plan.value
									: plan.value.toFixed(2)}{" "}
								in credits at provider rates
							</p>
							<p className="mt-3 text-xs text-muted-foreground">{plan.note}</p>
						</div>
					))}
				</div>
				<p className="mt-4 text-xs text-muted-foreground">
					Credits reset each cycle. Pay-as-you-go top-ups never expire and act
					as a fallback. Starter excludes frontier models (Opus, GPT-5, Gemini
					2.5 Pro, Grok 4); Plus and Pro include everything.
				</p>
			</section>

			{/* FAQ */}
			<section className="mt-16">
				<h2 className="mb-5 text-xl font-semibold tracking-tight">
					LLM Gateway Chat vs {comparison.competitor} FAQ
				</h2>
				<div className="divide-y rounded-2xl border bg-card">
					{comparison.faq.map((item) => (
						<details key={item.q} className="group px-5 py-4">
							<summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
								{item.q}
								<ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
							</summary>
							<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
								{item.a}
							</p>
						</details>
					))}
				</div>
			</section>

			{/* Final CTA */}
			<section className="mt-16 rounded-2xl border border-foreground/15 bg-card p-8 text-center shadow-sm">
				<h2 className="text-2xl font-bold tracking-tight">
					Every model. One subscription.
				</h2>
				<p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
					Chat with {US.modelCount} models — GPT, Claude, Gemini, Grok and more
					— from a single credit balance. Switch models mid-conversation.
				</p>
				<div className="mt-6 flex justify-center gap-3">
					<Button asChild size="lg">
						<Link href="/">
							Start chatting free
							<ArrowRight className="ml-1.5 h-4 w-4" />
						</Link>
					</Button>
					<Button asChild size="lg" variant="outline">
						<Link href="/pricing">Compare plans</Link>
					</Button>
				</div>
			</section>

			{/* Other comparisons */}
			<section className="mt-16">
				<h2 className="mb-5 text-base font-semibold text-muted-foreground">
					More comparisons
				</h2>
				<div className="grid gap-3 sm:grid-cols-2">
					{others.map((other) => (
						<Link
							key={other.slug}
							href={`/compare/${other.slug}`}
							className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/30"
						>
							<ThemTile
								slug={other.slug}
								competitor={other.competitor}
								size={32}
								radius={9}
							/>
							<div className="min-w-0 flex-1">
								<div className="text-sm font-medium">vs {other.competitor}</div>
								<div className="truncate text-xs text-muted-foreground">
									{other.competitorTagline}
								</div>
							</div>
							<ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
						</Link>
					))}
				</div>
			</section>
		</main>
	);
}
