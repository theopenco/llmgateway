import { ArrowRight, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";

import type { LucideIcon } from "lucide-react";
import type { Route } from "next";

export interface ProductCta {
	label: string;
	href: string;
	external?: boolean;
	variant?: "default" | "outline";
}

export function ProductCtaButtons({ ctas }: { ctas: ProductCta[] }) {
	return (
		<div className="flex flex-wrap justify-center gap-4">
			{ctas.map((cta) =>
				cta.external ? (
					<a
						key={cta.label}
						href={cta.href}
						target="_blank"
						rel="noopener noreferrer"
					>
						<Button
							variant={cta.variant ?? "default"}
							size="lg"
							className="gap-2"
						>
							{cta.label}
							<ExternalLink className="h-4 w-4" />
						</Button>
					</a>
				) : (
					<Link key={cta.label} href={cta.href as Route}>
						<Button
							variant={cta.variant ?? "default"}
							size="lg"
							className="gap-2"
						>
							{cta.label}
							<ArrowRight className="h-4 w-4" />
						</Button>
					</Link>
				),
			)}
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
}: {
	eyebrow: string;
	title: string;
	subtitle: string;
	description: string;
	ctas: ProductCta[];
	stats?: { value: string; label: string }[];
}) {
	return (
		<div className="relative border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-b from-zinc-50 to-background dark:from-zinc-900/50 dark:to-background">
			<div className="container mx-auto px-4 py-16 md:py-24 pt-32 md:pt-40">
				<div className="max-w-4xl mx-auto text-center">
					<Badge variant="outline" className="mb-4">
						{eyebrow}
					</Badge>
					<h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
						{title}
					</h1>
					<p className="text-xl md:text-2xl text-muted-foreground mb-8">
						{subtitle}
					</p>
					<p className="text-lg text-muted-foreground mb-8 max-w-3xl mx-auto">
						{description}
					</p>
					<ProductCtaButtons ctas={ctas} />
					{stats && stats.length > 0 && (
						<div className="mt-12 grid grid-cols-3 gap-6 max-w-xl mx-auto">
							{stats.map((stat) => (
								<div key={stat.label}>
									<div className="text-3xl font-bold">{stat.value}</div>
									<div className="text-sm text-muted-foreground mt-1">
										{stat.label}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
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
		<div className="space-y-4">
			{title && (
				<div className="text-center max-w-xl mx-auto">
					<h3 className="text-2xl font-bold mb-2">{title}</h3>
					{description && (
						<p className="text-muted-foreground leading-relaxed">
							{description}
						</p>
					)}
				</div>
			)}
			<div className="mx-auto max-w-5xl overflow-hidden rounded-xl border-2 border-border/80 bg-card p-1 shadow-[0_0_60px_-12px_rgba(59,130,246,0.15)]">
				<Image
					src={`/screenshots/${slug}-dark.png`}
					alt={alt}
					width={1440}
					height={900}
					className="hidden dark:block w-full h-auto rounded-lg"
				/>
				<Image
					src={`/screenshots/${slug}-light.png`}
					alt={alt}
					width={1440}
					height={900}
					className="block dark:hidden w-full h-auto rounded-lg"
				/>
			</div>
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
	columns?: 2 | 3;
}) {
	return (
		<section className="mb-16">
			<h2 className="text-3xl font-bold mb-8 text-center">{title}</h2>
			<div
				className={`grid grid-cols-1 md:grid-cols-2 ${
					columns === 3 ? "lg:grid-cols-3" : ""
				} gap-6`}
			>
				{features.map((feature) => (
					<div
						key={feature.title}
						className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card hover:shadow-lg transition-shadow"
					>
						<feature.icon className="h-8 w-8 mb-4 text-primary" />
						<h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
						<p className="text-muted-foreground">{feature.description}</p>
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
}: {
	title: string;
	description: string;
	ctas: ProductCta[];
}) {
	return (
		<section className="border-t border-zinc-200 dark:border-zinc-800 bg-gradient-to-b from-background to-zinc-50 dark:to-zinc-900/50">
			<div className="container mx-auto px-4 py-16 md:py-24">
				<div className="max-w-2xl mx-auto text-center">
					<h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
						{title}
					</h2>
					<p className="text-lg text-muted-foreground mb-8">{description}</p>
					<ProductCtaButtons ctas={ctas} />
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
