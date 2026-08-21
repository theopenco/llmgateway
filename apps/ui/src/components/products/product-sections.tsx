import { ArrowRight, ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/lib/components/button";
import { cn } from "@/lib/utils";

import type { LucideIcon } from "lucide-react";
import type { Route } from "next";

export type ProductAccent = "blue" | "emerald" | "amber" | "violet";

const ACCENTS: Record<
	ProductAccent,
	{ heroGlow: string; ctaGlow: string; eyebrow: string }
> = {
	blue: {
		heroGlow:
			"bg-[radial-gradient(70%_55%_at_50%_0%,rgba(59,130,246,0.14),transparent_70%)]",
		ctaGlow:
			"bg-[radial-gradient(70%_70%_at_50%_100%,rgba(59,130,246,0.10),transparent_70%)]",
		eyebrow: "text-blue-600 dark:text-blue-400",
	},
	emerald: {
		heroGlow:
			"bg-[radial-gradient(70%_55%_at_50%_0%,rgba(16,185,129,0.14),transparent_70%)]",
		ctaGlow:
			"bg-[radial-gradient(70%_70%_at_50%_100%,rgba(16,185,129,0.10),transparent_70%)]",
		eyebrow: "text-emerald-600 dark:text-emerald-400",
	},
	amber: {
		heroGlow:
			"bg-[radial-gradient(70%_55%_at_50%_0%,rgba(217,119,6,0.14),transparent_70%)]",
		ctaGlow:
			"bg-[radial-gradient(70%_70%_at_50%_100%,rgba(217,119,6,0.10),transparent_70%)]",
		eyebrow: "text-amber-600 dark:text-amber-400",
	},
	violet: {
		heroGlow:
			"bg-[radial-gradient(70%_55%_at_50%_0%,rgba(139,92,246,0.14),transparent_70%)]",
		ctaGlow:
			"bg-[radial-gradient(70%_70%_at_50%_100%,rgba(139,92,246,0.10),transparent_70%)]",
		eyebrow: "text-violet-600 dark:text-violet-400",
	},
};

export interface ProductCta {
	label: string;
	href: string;
	external?: boolean;
	variant?: "default" | "outline";
}

export function ProductCtaButtons({ ctas }: { ctas: ProductCta[] }) {
	return (
		<div className="flex flex-wrap items-center justify-center gap-3">
			{ctas.map((cta) => (
				<Button
					key={cta.label}
					asChild
					variant={cta.variant ?? "default"}
					size="lg"
					className="group h-12 gap-1.5 rounded-full px-7 text-[15px]"
				>
					{cta.external ? (
						<a href={cta.href} target="_blank" rel="noopener noreferrer">
							{cta.label}
							<ArrowUpRight className="size-4 opacity-70 transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
						</a>
					) : (
						<Link href={cta.href as Route}>
							{cta.label}
							<ArrowRight className="size-4 opacity-70 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
						</Link>
					)}
				</Button>
			))}
		</div>
	);
}

export function ProductHero({
	eyebrow,
	title,
	subtitle,
	description,
	ctas,
	stats,
	accent = "blue",
}: {
	eyebrow: string;
	title: string;
	subtitle: string;
	description: string;
	ctas: ProductCta[];
	stats?: { value: string; label: string }[];
	accent?: ProductAccent;
}) {
	return (
		<section className="relative overflow-hidden">
			<div
				aria-hidden
				className={cn(
					"pointer-events-none absolute inset-x-0 top-0 h-[36rem]",
					ACCENTS[accent].heroGlow,
				)}
			/>
			<div className="relative mx-auto max-w-6xl px-6 pb-20 pt-32 md:pb-28 md:pt-44">
				<div className="mx-auto max-w-3xl text-center">
					<p
						className={cn(
							"animate-hero-enter mb-6 text-[13px] font-semibold uppercase tracking-[0.14em]",
							ACCENTS[accent].eyebrow,
						)}
					>
						{eyebrow}
					</p>
					<h1 className="animate-hero-enter bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-balance text-5xl font-semibold leading-[1.04] tracking-[-0.03em] text-transparent md:text-6xl lg:text-7xl">
						{title}
					</h1>
					<p className="animate-hero-enter hero-enter-delay-1 mx-auto mt-5 max-w-xl text-balance text-lg font-medium tracking-[-0.01em] text-foreground/80 md:text-xl">
						{subtitle}
					</p>
					<p className="animate-hero-enter hero-enter-delay-1 mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground md:text-[17px]">
						{description}
					</p>
					<div className="animate-hero-enter hero-enter-delay-2 mt-9">
						<ProductCtaButtons ctas={ctas} />
					</div>
					{stats && stats.length > 0 && (
						<div className="animate-hero-enter hero-enter-delay-3 mx-auto mt-16 grid max-w-2xl grid-cols-3 divide-x divide-border/60">
							{stats.map((stat) => (
								<div key={stat.label} className="px-4">
									<div className="text-2xl font-semibold tracking-tight tabular-nums md:text-3xl">
										{stat.value}
									</div>
									<div className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground md:text-xs">
										{stat.label}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</section>
	);
}

export function ProductScreenshot({
	slug,
	alt,
	title,
	description,
}: {
	slug: string;
	alt: string;
	title?: string;
	description?: string;
}) {
	return (
		<figure className="scroll-reveal space-y-8">
			{title && (
				<figcaption className="mx-auto max-w-xl text-center">
					<h3 className="text-2xl font-semibold tracking-[-0.02em] md:text-3xl">
						{title}
					</h3>
					{description && (
						<p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
							{description}
						</p>
					)}
				</figcaption>
			)}
			<div className="inset-shadow-2xs ring-background dark:inset-shadow-white/20 relative mx-auto max-w-5xl overflow-hidden rounded-2xl border bg-background p-2 shadow-lg shadow-zinc-950/15 ring-1">
				<Image
					src={`/screenshots/${slug}-dark.png`}
					alt={alt}
					width={1440}
					height={900}
					className="hidden h-auto w-full rounded-xl dark:block"
				/>
				<Image
					src={`/screenshots/${slug}-light.png`}
					alt={alt}
					width={1440}
					height={900}
					className="block h-auto w-full rounded-xl dark:hidden"
				/>
			</div>
		</figure>
	);
}

export function ProductCodeBlock({
	code,
	filename,
}: {
	code: string;
	filename?: string;
}) {
	return (
		<div className="scroll-reveal mx-auto max-w-3xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-lg shadow-zinc-950/20">
			<div className="flex items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/60 px-4 py-3">
				<span aria-hidden className="size-3 rounded-full bg-[#ff5f57]" />
				<span aria-hidden className="size-3 rounded-full bg-[#febc2e]" />
				<span aria-hidden className="size-3 rounded-full bg-[#28c840]" />
				{filename && (
					<span className="ml-2 font-mono text-xs text-zinc-500">
						{filename}
					</span>
				)}
			</div>
			<pre className="overflow-x-auto p-6">
				<code className="font-mono text-[13px] leading-relaxed text-zinc-200">
					{code}
				</code>
			</pre>
		</div>
	);
}

export function ProductFeatureGrid({
	title,
	features,
	columns = 3,
}: {
	title: string;
	features: { icon: LucideIcon; title: string; description: string }[];
	columns?: 2 | 3 | 4;
}) {
	return (
		<section>
			<h2 className="scroll-reveal mx-auto max-w-2xl text-center text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
				{title}
			</h2>
			<div
				className={cn(
					"mt-12 grid grid-cols-1 gap-4 md:grid-cols-2",
					columns === 3 && "lg:grid-cols-3",
					columns === 4 && "lg:grid-cols-4",
				)}
			>
				{features.map((feature) => (
					<div
						key={feature.title}
						className="scroll-reveal rounded-2xl border border-border/70 bg-card/60 p-6 transition-[border-color,background-color] duration-200 ease-out hover:border-border hover:bg-card"
					>
						<div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-secondary ring-1 ring-border/60">
							<feature.icon
								className="size-5 text-foreground/80"
								strokeWidth={1.8}
							/>
						</div>
						<h3 className="text-[17px] font-semibold tracking-[-0.01em]">
							{feature.title}
						</h3>
						<p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
							{feature.description}
						</p>
					</div>
				))}
			</div>
		</section>
	);
}

export function ProductClosingCta({
	title,
	description,
	ctas,
	accent = "blue",
}: {
	title: string;
	description: string;
	ctas: ProductCta[];
	accent?: ProductAccent;
}) {
	return (
		<section className="relative overflow-hidden border-t border-border/50">
			<div
				aria-hidden
				className={cn(
					"pointer-events-none absolute inset-x-0 bottom-0 h-[24rem]",
					ACCENTS[accent].ctaGlow,
				)}
			/>
			<div className="relative mx-auto max-w-6xl px-6 py-24 md:py-32">
				<div className="scroll-reveal mx-auto max-w-2xl text-center">
					<h2 className="text-balance text-4xl font-semibold tracking-[-0.03em] md:text-5xl">
						{title}
					</h2>
					<p className="mx-auto mt-4 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
						{description}
					</p>
					<div className="mt-9">
						<ProductCtaButtons ctas={ctas} />
					</div>
				</div>
			</div>
		</section>
	);
}

export function productJsonLd({
	slug,
	name,
	description,
}: {
	slug: string;
	name: string;
	description: string;
}) {
	return [
		{
			"@context": "https://schema.org",
			"@type": "BreadcrumbList",
			itemListElement: [
				{
					"@type": "ListItem",
					position: 1,
					name: "Home",
					item: "https://llmgateway.io",
				},
				{
					"@type": "ListItem",
					position: 2,
					name,
					item: `https://llmgateway.io/products/${slug}`,
				},
			],
		},
		{
			"@context": "https://schema.org",
			"@type": "WebPage",
			name,
			description,
			url: `https://llmgateway.io/products/${slug}`,
			image: "https://llmgateway.io/opengraph.png?v=1",
			isPartOf: {
				"@type": "WebSite",
				name: "LLM Gateway",
				url: "https://llmgateway.io",
			},
			author: {
				"@type": "Organization",
				name: "LLM Gateway",
				url: "https://llmgateway.io",
			},
		},
	];
}
