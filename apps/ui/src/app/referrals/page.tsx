import {
	ArrowRight,
	Banana,
	Check,
	Code2,
	DollarSign,
	Gift,
	Globe,
	Image,
	KeyRound,
	Network,
	RefreshCw,
	Server,
	Share2,
	Shield,
	Sparkles,
	TrendingUp,
	Users,
	Zap,
} from "lucide-react";
import Link from "next/link";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { AuthLink } from "@/components/shared/auth-link";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";

import type { Metadata } from "next";
import type { Route } from "next";

export const metadata: Metadata = {
	title: "Referral Program | LLM Gateway",
	description:
		"Earn credits by referring new users to LLM Gateway. Get 1% of all LLM spending from users you refer, added directly to your account balance.",
	openGraph: {
		title: "Referral Program | LLM Gateway",
		description:
			"Earn 1% of all LLM spending from users you refer to LLM Gateway.",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Referral Program | LLM Gateway",
		description:
			"Earn 1% of all LLM spending from users you refer to LLM Gateway.",
	},
};

const sellingPoints = [
	{
		icon: Network,
		title: "210+ Models, One API",
		description:
			"Access OpenAI, Anthropic, Google, Meta, Mistral, and 25+ providers through a single OpenAI-compatible endpoint. Zero code changes to switch providers.",
		href: "/features/unified-api-interface",
		accent: "text-violet-500 dark:text-violet-400",
		accentBg: "bg-violet-500/10",
	},
	{
		icon: RefreshCw,
		title: "Automatic Failover",
		description:
			"When a provider goes down or rate-limits you, requests automatically route to the next best provider. Your users never notice the difference.",
		href: "/features/multi-provider-support",
		accent: "text-emerald-500 dark:text-emerald-400",
		accentBg: "bg-emerald-500/10",
	},
	{
		icon: Image,
		title: "Nano Banana Simulator",
		description:
			"Up to 20% off Google Gemini 3 Pro image generation. Use the cost simulator to see exactly how much you save at any volume.",
		href: "/nano-banana-simulator",
		accent: "text-amber-500 dark:text-amber-400",
		accentBg: "bg-amber-500/10",
	},
	{
		icon: DollarSign,
		title: "5% Platform Fee",
		description:
			"Lower than competitors. OpenRouter charges 5.5%. Bring your own keys and pay zero platform fees.",
		href: "/pricing",
		accent: "text-green-500 dark:text-green-400",
		accentBg: "bg-green-500/10",
	},
	{
		icon: Code2,
		title: "Dev Plans for AI Coding",
		description:
			"Fixed-price plans from $29/mo for Claude Code, Cursor, and Windsurf. Get 3x your subscription in monthly usage with all models included.",
		href: "/code",
		accent: "text-blue-500 dark:text-blue-400",
		accentBg: "bg-blue-500/10",
		external: true,
	},
	{
		icon: Shield,
		title: "Guardrails & Safety",
		description:
			"Built-in prompt injection protection, PII detection, secrets scanning, and custom content rules. Compliance without the overhead.",
		href: "/features/guardrails",
		accent: "text-rose-500 dark:text-rose-400",
		accentBg: "bg-rose-500/10",
	},
	{
		icon: Zap,
		title: "Prompt Caching",
		description:
			"Automatic response caching cuts costs and latency on repeated queries. Toggle it per-project from the dashboard.",
		href: "/features/performance-monitoring",
		accent: "text-orange-500 dark:text-orange-400",
		accentBg: "bg-orange-500/10",
	},
	{
		icon: Globe,
		title: "Self-Host for Free",
		description:
			"Open source under AGPLv3. Deploy on your own infrastructure for full data control, or use the managed cloud for instant setup.",
		href: "/features/self-hosted-or-cloud",
		accent: "text-cyan-500 dark:text-cyan-400",
		accentBg: "bg-cyan-500/10",
	},
	{
		icon: KeyRound,
		title: "Bring Your Own Keys",
		description:
			"Use your existing provider API keys with zero platform fee. Get unified analytics, failover, and guardrails on top of your own accounts.",
		href: "/pricing",
		accent: "text-purple-500 dark:text-purple-400",
		accentBg: "bg-purple-500/10",
	},
];

const migrationProviders = [
	{ name: "OpenRouter", slug: "open-router" },
	{ name: "Vercel AI Gateway", slug: "vercel-ai-gateway" },
	{ name: "LiteLLM", slug: "litellm" },
];

export default function ReferralsPublicPage() {
	return (
		<div className="min-h-screen bg-background text-foreground">
			<HeroRSC navbarOnly />

			{/* Hero */}
			<section className="relative overflow-hidden border-b bg-linear-to-b from-primary/5 via-background to-background">
				<div className="absolute inset-0 bg-grid-slate-100 mask-[linear-gradient(0deg,transparent,black)] dark:bg-grid-slate-800" />
				<div className="container relative mx-auto px-4 py-16 md:py-24 lg:py-32">
					<div className="mx-auto max-w-3xl space-y-8 text-center">
						<Badge
							variant="secondary"
							className="inline-flex items-center gap-2 px-4 py-1.5"
						>
							<Gift className="h-3.5 w-3.5 text-primary" />
							<span className="text-sm font-medium">Referral Program</span>
						</Badge>

						<h1 className="font-display text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
							Share the gateway,{" "}
							<span className="bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent">
								earn credits
							</span>
						</h1>

						<p className="text-pretty text-base text-muted-foreground sm:text-lg md:text-xl">
							Earn{" "}
							<span className="font-semibold text-foreground">
								1% of all LLM spending
							</span>{" "}
							from every team you refer. Below is everything that makes LLM
							Gateway worth recommending.
						</p>

						<div className="flex flex-col items-center justify-center gap-4 pt-4 sm:flex-row">
							<Button
								size="lg"
								className="group h-12 px-8 text-base font-medium"
								asChild
							>
								<AuthLink href="/signup">
									Get started
									<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</AuthLink>
							</Button>
							<Button
								variant="outline"
								size="lg"
								className="h-12 px-8 text-base font-medium"
								asChild
							>
								<Link href="#why-switch">See why teams switch</Link>
							</Button>
						</div>

						<div className="grid gap-4 pt-8 sm:grid-cols-3">
							<Card className="border-primary/20 bg-card/50 backdrop-blur">
								<CardContent className="p-6 text-center">
									<div className="font-display text-3xl font-bold text-primary">
										1%
									</div>
									<div className="mt-1 text-sm text-muted-foreground">
										Of their LLM spend
									</div>
								</CardContent>
							</Card>
							<Card className="border-primary/20 bg-card/50 backdrop-blur">
								<CardContent className="p-6 text-center">
									<div className="font-display text-3xl font-bold text-primary">
										&infin;
									</div>
									<div className="mt-1 text-sm text-muted-foreground">
										Unlimited referrals
									</div>
								</CardContent>
							</Card>
							<Card className="border-primary/20 bg-card/50 backdrop-blur">
								<CardContent className="p-6 text-center">
									<div className="font-display text-3xl font-bold text-primary">
										Auto
									</div>
									<div className="mt-1 text-sm text-muted-foreground">
										Credits added instantly
									</div>
								</CardContent>
							</Card>
						</div>
					</div>
				</div>
			</section>

			{/* Why Teams Switch */}
			<section id="why-switch" className="scroll-mt-20">
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-6xl space-y-12">
						<div className="space-y-4 text-center">
							<Badge variant="outline" className="text-xs">
								Why Teams Switch
							</Badge>
							<h2 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
								Everything you need to make the case
							</h2>
							<p className="mx-auto max-w-2xl text-pretty text-muted-foreground md:text-lg">
								These are the features that convince teams to switch. Each one
								links to a detailed page you can share.
							</p>
						</div>

						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{sellingPoints.map((point) => {
								const Icon = point.icon;
								const content = (
									<Card className="group relative h-full overflow-hidden border transition-all hover:border-primary/40 hover:shadow-lg">
										<div className="absolute right-0 top-0 h-32 w-32 translate-x-12 -translate-y-12 rounded-full bg-primary/5 transition-transform group-hover:scale-150" />
										<CardContent className="relative flex h-full flex-col p-6">
											<div
												className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${point.accentBg}`}
											>
												<Icon className={`h-5 w-5 ${point.accent}`} />
											</div>
											<h3 className="mb-2 text-lg font-semibold tracking-tight">
												{point.title}
											</h3>
											<p className="mb-4 flex-grow text-sm leading-relaxed text-muted-foreground">
												{point.description}
											</p>
											<div
												className={`inline-flex items-center text-sm font-medium ${point.accent}`}
											>
												Learn more
												<ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
											</div>
										</CardContent>
									</Card>
								);

								if (point.external) {
									return (
										<a
											key={point.title}
											href={point.href}
											target="_blank"
											rel="noopener noreferrer"
											className="h-full"
										>
											{content}
										</a>
									);
								}

								return (
									<Link
										key={point.title}
										href={point.href as Route}
										className="h-full"
										prefetch={true}
									>
										{content}
									</Link>
								);
							})}
						</div>
					</div>
				</div>
			</section>

			{/* Nano Banana Spotlight */}
			<section className="border-y bg-linear-to-b from-amber-500/5 via-background to-background">
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-5xl">
						<div className="grid items-center gap-8 md:grid-cols-2">
							<div className="space-y-6">
								<Badge
									variant="outline"
									className="border-amber-500/30 text-amber-600 dark:text-amber-400"
								>
									<Banana className="mr-1.5 h-3.5 w-3.5" />
									Cost Savings Tool
								</Badge>
								<h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
									Show them the savings
								</h2>
								<p className="text-muted-foreground leading-relaxed">
									The Nano Banana Simulator lets prospects calculate their exact
									savings on Gemini 3 Pro image generation compared to Google AI
									Studio direct pricing. Adjust the monthly spend slider and
									watch the numbers update in real time.
								</p>
								<ul className="space-y-3">
									<li className="flex items-start gap-3 text-sm">
										<div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
											<Check className="h-3 w-3 text-amber-500" />
										</div>
										<span>Up to 20% off Google direct pricing</span>
									</li>
									<li className="flex items-start gap-3 text-sm">
										<div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
											<Check className="h-3 w-3 text-amber-500" />
										</div>
										<span>
											Interactive calculator for $100 to $500k monthly spend
										</span>
									</li>
									<li className="flex items-start gap-3 text-sm">
										<div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
											<Check className="h-3 w-3 text-amber-500" />
										</div>
										<span>Shareable URL with custom discount percentage</span>
									</li>
								</ul>
								<Button variant="outline" className="group" asChild>
									<Link href="/nano-banana-simulator" prefetch={true}>
										Open the simulator
										<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
									</Link>
								</Button>
							</div>
							<div className="relative">
								<Card className="border-amber-500/20 bg-card/80 backdrop-blur">
									<CardContent className="p-6 md:p-8">
										<div className="space-y-6">
											<div className="text-center">
												<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
													Example Savings at $10k/mo
												</p>
											</div>
											<div className="grid grid-cols-2 gap-4">
												<div className="rounded-lg border bg-background p-4 text-center">
													<p className="text-xs text-muted-foreground">
														Google Direct
													</p>
													<p className="font-display mt-1 text-2xl font-bold">
														$10,000
													</p>
												</div>
												<div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
													<p className="text-xs text-emerald-600 dark:text-emerald-400">
														LLM Gateway
													</p>
													<p className="font-display mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
														$8,000
													</p>
												</div>
											</div>
											<div className="rounded-lg bg-emerald-500/10 p-4 text-center">
												<p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
													You save $2,000/mo ($24,000/yr)
												</p>
											</div>
										</div>
									</CardContent>
								</Card>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Migration & Dev Plans */}
			<section>
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-5xl">
						<div className="grid gap-6 md:grid-cols-2">
							{/* Migration Guides */}
							<Card className="group overflow-hidden border-2 transition-all hover:border-primary/40 hover:shadow-lg">
								<CardContent className="flex h-full flex-col p-8">
									<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10">
										<Server className="h-6 w-6 text-blue-500 dark:text-blue-400" />
									</div>
									<h3 className="font-display mb-2 text-xl font-bold">
										Migration Guides
									</h3>
									<p className="mb-6 flex-grow text-sm leading-relaxed text-muted-foreground">
										Step-by-step guides to switch from competitors with minimal
										code changes. Our OpenAI-compatible API makes it
										straightforward.
									</p>
									<div className="space-y-2">
										{migrationProviders.map((provider) => (
											<Link
												key={provider.slug}
												href={`/migration/${provider.slug}`}
												className="flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm transition-colors hover:bg-accent"
												prefetch={true}
											>
												<span className="font-medium">{provider.name}</span>
												<ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
											</Link>
										))}
									</div>
									<Button
										variant="outline"
										size="sm"
										className="mt-4 group/btn"
										asChild
									>
										<Link href="/migration" prefetch={true}>
											View all guides
											<ArrowRight className="ml-2 h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" />
										</Link>
									</Button>
								</CardContent>
							</Card>

							{/* Dev Plans */}
							<Card className="group overflow-hidden border-2 transition-all hover:border-primary/40 hover:shadow-lg">
								<CardContent className="flex h-full flex-col p-8">
									<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10">
										<Code2 className="h-6 w-6 text-violet-500 dark:text-violet-400" />
									</div>
									<h3 className="font-display mb-2 text-xl font-bold">
										Dev Plans for AI Coding
									</h3>
									<p className="mb-6 flex-grow text-sm leading-relaxed text-muted-foreground">
										Fixed-price subscriptions for AI coding tools. Works with
										Claude Code, Cursor, Windsurf, and any OpenAI-compatible
										tool.
									</p>
									<div className="space-y-2">
										{[
											{
												name: "Lite",
												price: "$29",
												value: "$87 in usage",
											},
											{
												name: "Pro",
												price: "$79",
												value: "$237 in usage",
												popular: true,
											},
											{
												name: "Max",
												price: "$179",
												value: "$537 in usage",
											},
										].map((plan) => (
											<div
												key={plan.name}
												className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm ${plan.popular ? "border-primary/40 bg-primary/5" : ""}`}
											>
												<span className="font-medium">
													{plan.name}
													{plan.popular ? (
														<Badge
															variant="secondary"
															className="ml-2 text-[10px]"
														>
															Popular
														</Badge>
													) : null}
												</span>
												<span className="text-muted-foreground">
													{plan.price}/mo &rarr;{" "}
													<span className="text-foreground">{plan.value}</span>
												</span>
											</div>
										))}
									</div>
									<Button
										variant="outline"
										size="sm"
										className="mt-4 group/btn"
										asChild
									>
										<a href="/code" target="_blank" rel="noopener noreferrer">
											Explore dev plans
											<ArrowRight className="ml-2 h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" />
										</a>
									</Button>
								</CardContent>
							</Card>
						</div>
					</div>
				</div>
			</section>

			{/* Competitive Edge */}
			<section className="border-y bg-muted/30">
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-5xl space-y-12">
						<div className="space-y-4 text-center">
							<Badge variant="outline" className="text-xs">
								Competitive Edge
							</Badge>
							<h2 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl">
								How we compare
							</h2>
						</div>

						<Card className="overflow-hidden border-2">
							<div className="overflow-x-auto">
								<table className="w-full text-sm">
									<thead>
										<tr className="border-b bg-muted/50">
											<th className="px-6 py-4 text-left font-medium text-muted-foreground">
												Feature
											</th>
											<th className="px-6 py-4 text-center font-semibold">
												LLM Gateway
											</th>
											<th className="px-6 py-4 text-center font-medium text-muted-foreground">
												OpenRouter
											</th>
										</tr>
									</thead>
									<tbody>
										{[
											{
												feature: "Platform Fee",
												us: "5%",
												them: "5.5%",
											},
											{
												feature: "BYOK Fee",
												us: "Free",
												them: "1M free reqs/mo, then 5%",
											},
											{
												feature: "Auto Failover",
												us: "Built-in",
												them: "Limited",
											},
											{
												feature: "Analytics",
												us: "Request-level insights",
												them: "Basic",
											},
											{
												feature: "Self-Hosting",
												us: "Free (AGPLv3)",
												them: "Not available",
											},
											{
												feature: "Guardrails",
												us: "PII, injection, secrets",
												them: "Not available",
											},
											{
												feature: "Dev Plans (Coding)",
												us: "From $29/mo",
												them: "Not available",
											},
											{
												feature: "Image Gen Discounts",
												us: "Up to 20% off",
												them: "No discounts",
											},
										].map((row) => (
											<tr key={row.feature} className="border-b last:border-0">
												<td className="px-6 py-3 font-medium">{row.feature}</td>
												<td className="px-6 py-3 text-center font-medium text-primary">
													{row.us}
												</td>
												<td className="px-6 py-3 text-center text-muted-foreground">
													{row.them}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</Card>

						<div className="text-center">
							<Button variant="outline" className="group" asChild>
								<Link href="/compare/open-router" prefetch={true}>
									See full comparison
									<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</Button>
						</div>
					</div>
				</div>
			</section>

			{/* How Referrals Work */}
			<section>
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-5xl space-y-12">
						<div className="space-y-4 text-center">
							<Badge variant="outline" className="text-xs">
								3 Simple Steps
							</Badge>
							<h2 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
								How referrals work
							</h2>
						</div>

						<div className="grid gap-6 md:grid-cols-3">
							{[
								{
									step: 1,
									icon: Sparkles,
									title: "Unlock referrals",
									description:
										"Top up $100 in credits to become eligible and access your unique referral link from the dashboard.",
								},
								{
									step: 2,
									icon: Share2,
									title: "Share your link",
									description:
										"Send your referral link to teams who could benefit. Share any feature page above to make the case.",
								},
								{
									step: 3,
									icon: TrendingUp,
									title: "Earn continuously",
									description:
										"Automatically earn 1% of their LLM spending as credits, deposited directly to your account balance.",
								},
							].map((item) => {
								const Icon = item.icon;
								return (
									<Card
										key={item.step}
										className="group relative overflow-hidden border-2 transition-all hover:border-primary/50 hover:shadow-lg"
									>
										<div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-primary/10 transition-transform group-hover:scale-150" />
										<CardContent className="relative space-y-4 p-8">
											<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
												<Icon className="h-6 w-6" />
											</div>
											<div className="space-y-2">
												<div className="flex items-center gap-2">
													<Badge
														variant="secondary"
														className="h-6 w-6 justify-center rounded-full p-0 text-xs font-bold"
													>
														{item.step}
													</Badge>
													<h3 className="text-lg font-semibold">
														{item.title}
													</h3>
												</div>
												<p className="text-sm leading-relaxed text-muted-foreground">
													{item.description}
												</p>
											</div>
										</CardContent>
									</Card>
								);
							})}
						</div>
					</div>
				</div>
			</section>

			{/* Program Details */}
			<section className="border-t bg-muted/30">
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-5xl">
						<Card className="border-2">
							<CardContent className="p-8 md:p-12">
								<div className="space-y-8">
									<div className="flex items-center gap-3">
										<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
											<Gift className="h-5 w-5 text-primary" />
										</div>
										<h3 className="font-display text-2xl font-bold">
											Program details
										</h3>
									</div>

									<div className="grid gap-4 md:grid-cols-2">
										{[
											{
												title: "Post-discount earnings",
												description:
													"Commission is calculated on LLM usage after any discounts are applied.",
											},
											{
												title: "Direct credit deposits",
												description:
													"Credits are automatically added to your balance. No manual claims needed.",
											},
											{
												title: "Use for any LLM service",
												description:
													"Referral credits work for any model or provider. Cannot be withdrawn.",
											},
											{
												title: "Unlimited referrals",
												description:
													"No cap on how many users you refer or how much you can earn.",
											},
										].map((detail) => (
											<div key={detail.title} className="flex gap-3">
												<div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
													<Check className="h-3 w-3 text-primary" />
												</div>
												<div className="space-y-1">
													<p className="font-medium">{detail.title}</p>
													<p className="text-sm leading-relaxed text-muted-foreground">
														{detail.description}
													</p>
												</div>
											</div>
										))}
									</div>

									<div className="rounded-lg border bg-muted/50 p-6">
										<div className="flex items-start gap-3">
											<Users className="mt-0.5 h-5 w-5 text-primary" />
											<div className="space-y-1">
												<p className="font-medium">Eligibility</p>
												<p className="text-sm leading-relaxed text-muted-foreground">
													Top up $100 in credits to unlock. Available in your
													organization dashboard under Referrals.
												</p>
											</div>
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
					</div>
				</div>
			</section>

			{/* Final CTA */}
			<section className="border-t">
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-3xl space-y-8 text-center">
						<div className="space-y-4">
							<h2 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
								Ready to start earning?
							</h2>
							<p className="mx-auto max-w-2xl text-pretty text-muted-foreground md:text-lg">
								Sign up, unlock the referral program, and share the features
								above with your network. Every team that switches earns you
								credits.
							</p>
						</div>
						<div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
							<Button
								asChild
								size="lg"
								className="group h-12 px-8 text-base font-medium"
							>
								<AuthLink href="/signup">
									Get started
									<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</AuthLink>
							</Button>
							<Button
								asChild
								variant="outline"
								size="lg"
								className="h-12 px-8 text-base font-medium"
							>
								<Link href="/pricing" prefetch={true}>
									View pricing
								</Link>
							</Button>
						</div>
					</div>
				</div>
			</section>

			<Footer />
		</div>
	);
}
