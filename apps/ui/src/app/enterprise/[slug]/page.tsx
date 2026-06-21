import {
	ArrowRight,
	ArrowUpRight,
	BadgeCheck,
	Bell,
	CheckCircle2,
	FileSearch,
	GitBranch,
	HelpCircle,
	Lock,
	Paintbrush,
	Sparkles,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	enterpriseFeatures,
	getEnterpriseFeatureBySlug,
} from "@/lib/enterprise-features";

import type { Metadata } from "next";

interface PageProps {
	params: Promise<{ slug: string }>;
}

const iconMap = {
	"shield-check": ShieldCheck,
	"badge-check": BadgeCheck,
	"git-branch": GitBranch,
	audit: FileSearch,
	bell: Bell,
	lock: Lock,
	paintbrush: Paintbrush,
} as const;

const accentBg: Record<string, string> = {
	indigo: "bg-indigo-500/10 text-indigo-500 ring-indigo-500/20",
	amber: "bg-amber-500/10 text-amber-500 ring-amber-500/20",
	emerald: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20",
	rose: "bg-rose-500/10 text-rose-500 ring-rose-500/20",
	sky: "bg-sky-500/10 text-sky-500 ring-sky-500/20",
	violet: "bg-violet-500/10 text-violet-500 ring-violet-500/20",
};

const accentGlow: Record<string, string> = {
	indigo: "from-indigo-500/20 via-transparent to-transparent",
	amber: "from-amber-500/20 via-transparent to-transparent",
	emerald: "from-emerald-500/20 via-transparent to-transparent",
	rose: "from-rose-500/20 via-transparent to-transparent",
	sky: "from-sky-500/20 via-transparent to-transparent",
	violet: "from-violet-500/20 via-transparent to-transparent",
};

function renderTextWithLinks(text: string): React.ReactNode {
	const parts = text.split(/(\[\[[^\]]+\]\])/g);
	return parts.map((part, i) => {
		const match = /^\[\[([^\]]+)\]\]$/.exec(part);
		if (!match) {
			return <Fragment key={i}>{part}</Fragment>;
		}
		const slug = match[1];
		const target = enterpriseFeatures.find((f) => f.slug === slug);
		const label = target?.title ?? slug;
		return (
			<Link
				key={i}
				href={`/enterprise/${slug}`}
				className="text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground transition-colors"
			>
				{label}
			</Link>
		);
	});
}

export default async function EnterpriseFeaturePage({ params }: PageProps) {
	const { slug } = await params;
	const feature = getEnterpriseFeatureBySlug(slug);

	if (!feature) {
		notFound();
	}

	const Icon = iconMap[feature.iconName];

	const breadcrumbSchema = {
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
				name: "Enterprise",
				item: "https://llmgateway.io/enterprise",
			},
			{
				"@type": "ListItem",
				position: 3,
				name: feature.title,
				item: `https://llmgateway.io/enterprise/${slug}`,
			},
		],
	};

	const faqSchema = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: feature.faq.map((q) => ({
			"@type": "Question",
			name: q.question,
			acceptedAnswer: {
				"@type": "Answer",
				text: q.answer,
			},
		})),
	};

	const productSchema = {
		"@context": "https://schema.org",
		"@type": "Service",
		name: `LLM Gateway Enterprise – ${feature.title}`,
		description: feature.longDescription,
		brand: {
			"@type": "Brand",
			name: "LLM Gateway",
		},
		category: "Enterprise AI Infrastructure",
		url: `https://llmgateway.io/enterprise/${slug}`,
	};

	const otherFeatures = enterpriseFeatures.filter((f) => f.slug !== slug);

	return (
		<>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
			/>
			<HeroRSC navbarOnly />
			<main className="relative min-h-screen bg-background">
				<section className="relative overflow-hidden border-b border-border">
					<div
						className={`pointer-events-none absolute inset-0 bg-gradient-radial ${accentGlow[feature.accent]} opacity-60`}
					/>
					<div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

					<div className="container relative mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-20 sm:pt-40 sm:pb-28">
						<div className="mx-auto max-w-4xl">
							<nav className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
								<Link
									href="/enterprise"
									className="hover:text-foreground transition-colors"
								>
									Enterprise
								</Link>
								<span>/</span>
								<span className="text-foreground">{feature.title}</span>
							</nav>

							<div className="flex flex-col gap-6 items-start">
								<span
									className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ${accentBg[feature.accent]}`}
								>
									<Icon className="h-6 w-6" />
								</span>

								<Badge
									variant="outline"
									className="font-mono uppercase text-xs tracking-wider"
								>
									Enterprise capability
								</Badge>

								<h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
									{feature.title}
								</h1>

								<p className="text-xl text-muted-foreground text-balance leading-relaxed sm:text-2xl">
									{feature.subtitle}
								</p>

								<p className="text-base text-foreground/80 leading-relaxed max-w-3xl">
									{renderTextWithLinks(feature.longDescription)}
								</p>

								<div className="flex flex-wrap gap-3 pt-2">
									<Button asChild size="lg">
										<Link href="/enterprise#contact">
											Talk to sales
											<ArrowRight className="ml-2 h-4 w-4" />
										</Link>
									</Button>
									<Button asChild size="lg" variant="outline">
										<Link href="/signup">Try LLM Gateway free</Link>
									</Button>
								</div>
							</div>
						</div>
					</div>
				</section>

				<section className="border-b border-border">
					<div className="container mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
						<div className="mx-auto max-w-6xl">
							<div className="flex items-center gap-3 mb-12">
								<span
									className={`flex h-9 w-9 items-center justify-center rounded-lg ring-1 ${accentBg[feature.accent]}`}
								>
									<Sparkles className="h-4 w-4" />
								</span>
								<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
									Why teams turn it on
								</h2>
							</div>

							<div className="grid gap-px bg-border rounded-2xl border border-border overflow-hidden md:grid-cols-2">
								{feature.benefits.map((benefit, i) => (
									<div
										key={i}
										className="bg-background p-8 hover:bg-card transition-colors"
									>
										<div className="flex items-start gap-3 mb-3">
											<CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
											<h3 className="text-lg font-semibold">{benefit.title}</h3>
										</div>
										<p className="text-muted-foreground leading-relaxed pl-8">
											{benefit.description}
										</p>
									</div>
								))}
							</div>
						</div>
					</div>
				</section>

				<section className="border-b border-border bg-muted/20">
					<div className="container mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
						<div className="mx-auto max-w-6xl">
							<div className="mb-12">
								<p className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3">
									How it works
								</p>
								<h2 className="text-3xl font-bold tracking-tight sm:text-4xl text-balance max-w-3xl">
									From decision to deployed in three short steps
								</h2>
							</div>

							<ol className="grid gap-6 md:grid-cols-3">
								{feature.howItWorks.map((step) => (
									<li
										key={step.step}
										className="relative flex flex-col gap-4 rounded-2xl border border-border bg-background p-6"
									>
										<div className="flex items-baseline gap-3">
											<span className="text-4xl font-bold tracking-tight text-muted-foreground/30 font-mono">
												{step.step}
											</span>
										</div>
										<h3 className="text-lg font-semibold tracking-tight">
											{step.title}
										</h3>
										<p className="text-sm text-muted-foreground leading-relaxed">
											{step.description}
										</p>
									</li>
								))}
							</ol>
						</div>
					</div>
				</section>

				{feature.codeExample && (
					<section className="border-b border-border">
						<div className="container mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
							<div className="mx-auto max-w-4xl">
								<div className="mb-8">
									<p className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3">
										{feature.codeExample.language}
									</p>
									<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
										{feature.codeExample.title}
									</h2>
								</div>
								<div className="relative rounded-2xl border border-border bg-zinc-950 overflow-hidden">
									<div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
										<span className="h-3 w-3 rounded-full bg-zinc-700" />
										<span className="h-3 w-3 rounded-full bg-zinc-700" />
										<span className="h-3 w-3 rounded-full bg-zinc-700" />
									</div>
									<pre className="p-6 overflow-x-auto">
										<code className="text-sm text-zinc-100 font-mono leading-relaxed">
											{feature.codeExample.code}
										</code>
									</pre>
								</div>
							</div>
						</div>
					</section>
				)}

				<section className="border-b border-border">
					<div className="container mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
						<div className="mx-auto max-w-6xl">
							<div className="mb-12">
								<p className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3">
									Real-world use cases
								</p>
								<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
									Why customers actually adopt this
								</h2>
							</div>
							<div className="grid gap-6 md:grid-cols-3">
								{feature.useCases.map((useCase, i) => (
									<div
										key={i}
										className="relative flex flex-col gap-3 rounded-2xl border border-border bg-card/60 backdrop-blur p-6 hover:border-foreground/20 transition-colors"
									>
										<div className="flex items-center gap-2">
											<span className="font-mono text-xs text-muted-foreground">
												0{i + 1}
											</span>
										</div>
										<h3 className="text-lg font-semibold tracking-tight">
											{useCase.title}
										</h3>
										<p className="text-sm text-muted-foreground leading-relaxed">
											{useCase.description}
										</p>
									</div>
								))}
							</div>
						</div>
					</div>
				</section>

				{feature.faq.length > 0 && (
					<section className="border-b border-border bg-muted/20">
						<div className="container mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
							<div className="mx-auto max-w-3xl">
								<div className="flex items-center gap-3 mb-12">
									<HelpCircle className="h-7 w-7 text-muted-foreground" />
									<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
										Frequently asked
									</h2>
								</div>
								<dl className="space-y-6">
									{feature.faq.map((item, i) => (
										<div
											key={i}
											className="rounded-2xl border border-border bg-background p-6"
										>
											<dt className="text-lg font-semibold mb-3">
												{item.question}
											</dt>
											<dd className="text-muted-foreground leading-relaxed">
												{renderTextWithLinks(item.answer)}
											</dd>
										</div>
									))}
								</dl>
							</div>
						</div>
					</section>
				)}

				<section className="border-b border-border">
					<div className="container mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
						<div className="mx-auto max-w-6xl">
							<div className="mb-12">
								<p className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3">
									More enterprise capabilities
								</p>
								<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
									The rest of the enterprise stack
								</h2>
							</div>
							<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
								{otherFeatures.map((other) => {
									const OtherIcon = iconMap[other.iconName];
									return (
										<Link
											key={other.slug}
											href={`/enterprise/${other.slug}`}
											className="group flex flex-col gap-3 rounded-2xl border border-border bg-card/40 p-5 hover:bg-card hover:border-foreground/20 transition-all"
										>
											<div className="flex items-center justify-between">
												<span
													className={`flex h-9 w-9 items-center justify-center rounded-lg ring-1 ${accentBg[other.accent]}`}
												>
													<OtherIcon className="h-4 w-4" />
												</span>
												<ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
											</div>
											<h3 className="font-semibold tracking-tight">
												{other.title}
											</h3>
											<p className="text-sm text-muted-foreground line-clamp-2">
												{other.description}
											</p>
										</Link>
									);
								})}
							</div>
						</div>
					</div>
				</section>

				<section className="relative overflow-hidden">
					<div
						className={`pointer-events-none absolute inset-0 bg-gradient-radial ${accentGlow[feature.accent]} opacity-40`}
					/>
					<div className="container relative mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-center">
						<div className="mx-auto max-w-2xl">
							<h2 className="text-3xl font-bold tracking-tight sm:text-4xl text-balance mb-4">
								See {feature.title.toLowerCase()} on your real workloads
							</h2>
							<p className="text-lg text-muted-foreground mb-8 text-balance">
								Bring a sample workload to a 30-minute call. We'll wire it up
								live and show you the actual experience your team will get.
							</p>
							<div className="flex flex-wrap justify-center gap-3">
								<Button asChild size="lg">
									<Link href="/enterprise#contact">
										Book a walkthrough
										<ArrowRight className="ml-2 h-4 w-4" />
									</Link>
								</Button>
								<Button asChild size="lg" variant="outline">
									<Link href="/signup">Start free</Link>
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

export async function generateStaticParams() {
	return enterpriseFeatures.map((feature) => ({
		slug: feature.slug,
	}));
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { slug } = await params;
	const feature = getEnterpriseFeatureBySlug(slug);

	if (!feature) {
		return {};
	}

	const title = `${feature.title} – Enterprise LLM Gateway`;
	const description = feature.description;
	const url = `https://llmgateway.io/enterprise/${slug}`;

	return {
		title,
		description,
		keywords: feature.keywords.join(", "),
		alternates: {
			canonical: url,
		},
		openGraph: {
			title,
			description,
			type: "website",
			url,
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}
