import { Code2, GitFork, Globe2, ShieldCheck } from "lucide-react";
import Link from "next/link";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";

import { MARKETING_STATS } from "@llmgateway/shared";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "About",
	description:
		"LLM Gateway is an open-source LLM API gateway routing requests across 40+ providers through one OpenAI-compatible API. Learn who builds it and why.",
	alternates: { canonical: "/about" },
	openGraph: {
		title: "About | LLM Gateway",
		description:
			"LLM Gateway is an open-source LLM API gateway routing requests across 40+ providers through one OpenAI-compatible API. Learn who builds it and why.",
		url: "https://llmgateway.io/about",
		type: "website",
	},
};

const principles = [
	{
		icon: GitFork,
		title: "Open source first",
		description:
			"The entire platform — gateway, dashboard, API, and worker — is AGPLv3. Anyone can audit the code, self-host it, or contribute on GitHub.",
	},
	{
		icon: Code2,
		title: "Developer experience",
		description:
			"One OpenAI-compatible endpoint, one API key, drop-in SDK compatibility. Switching providers should be a one-line change, not a migration.",
	},
	{
		icon: ShieldCheck,
		title: "Reliability as a feature",
		description:
			"Automatic failover, health monitoring, and intelligent routing keep requests flowing even when individual providers go down.",
	},
	{
		icon: Globe2,
		title: "No lock-in",
		description:
			"Pass-through provider pricing, free bring-your-own-keys, and a self-hostable stack mean you can leave any time — which is why teams stay.",
	},
];

export default function AboutPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<Navbar />
			<main>
				<section className="relative overflow-hidden">
					<div className="mx-auto max-w-5xl px-6 pt-24 pb-12 md:pt-36 md:pb-20 text-center">
						<h1 className="text-4xl md:text-6xl font-bold tracking-tight text-balance">
							About LLM Gateway
						</h1>
						<p className="mx-auto mt-6 max-w-2xl text-base md:text-lg text-muted-foreground">
							LLM Gateway is an open-source LLM API gateway: one
							OpenAI-compatible API and one key for {MARKETING_STATS.models}{" "}
							models across {MARKETING_STATS.providers} providers, with usage
							analytics, cost tracking, caching, and automatic failover.
						</p>
					</div>
				</section>

				<section className="w-full py-12 md:py-16 bg-background">
					<div className="container px-4 md:px-6 max-w-3xl mx-auto space-y-6 text-base leading-relaxed text-muted-foreground">
						<h2 className="text-3xl font-bold tracking-tight text-foreground">
							What we do
						</h2>
						<p>
							Teams building with large language models juggle multiple provider
							accounts, incompatible SDKs, separate invoices, and no unified
							view of what their AI features actually cost. LLM Gateway sits
							between your application and every provider: you send requests to
							one endpoint, and the gateway routes them to OpenAI, Anthropic,
							Google, Meta, Mistral, DeepSeek, and dozens of other providers —
							with per-request cost tracking, response caching, and automatic
							failover when a provider degrades.
						</p>
						<p>
							The platform has routed {MARKETING_STATS.tokensRouted} tokens
							across {MARKETING_STATS.requestsRouted} requests, and adds new
							models within 48 hours of their provider release. Developers use
							the hosted service on pay-as-you-go credits with a flat{" "}
							{MARKETING_STATS.platformFee} platform fee, bring their own
							provider keys for free, or self-host the entire stack with one
							Docker command.
						</p>
						<h2 className="text-3xl font-bold tracking-tight text-foreground pt-4">
							Who we are
						</h2>
						<p>
							LLM Gateway is operated by Polar Lights LLC, 16192 Coastal
							Highway, Lewes, DE 19958, United States, and developed in the open
							by a distributed team and community of contributors on{" "}
							<a
								href="https://github.com/theopenco/llmgateway"
								className="text-foreground underline underline-offset-4"
								target="_blank"
								rel="noopener noreferrer"
							>
								GitHub
							</a>
							. The full source is licensed under AGPLv3, with commercial
							enterprise licensing available for the features in the{" "}
							<code>ee/</code> directory.
						</p>
					</div>
				</section>

				<section className="w-full py-12 md:py-16 bg-background">
					<div className="container px-4 md:px-6 max-w-5xl mx-auto">
						<h2 className="text-3xl font-bold tracking-tight mb-8 text-center">
							What we believe
						</h2>
						<div className="grid gap-6 sm:grid-cols-2">
							{principles.map(({ icon: Icon, title, description }) => (
								<div
									key={title}
									className="rounded-xl border border-border/60 bg-card p-6"
								>
									<Icon className="h-6 w-6 text-primary" aria-hidden="true" />
									<h3 className="mt-4 text-lg font-semibold text-foreground">
										{title}
									</h3>
									<p className="mt-2 text-sm text-muted-foreground">
										{description}
									</p>
								</div>
							))}
						</div>
					</div>
				</section>

				<section className="w-full py-12 md:py-20 bg-background">
					<div className="container px-4 md:px-6 max-w-3xl mx-auto text-center">
						<h2 className="text-3xl font-bold tracking-tight">
							Get in touch or get started
						</h2>
						<p className="mt-4 text-muted-foreground">
							Questions about the product, partnerships, or enterprise plans?{" "}
							<Link
								href="/contact"
								className="text-foreground underline underline-offset-4"
							>
								Contact us
							</Link>
							.
						</p>
						<div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
							<Button size="lg" className="bg-primary hover:bg-primary/90">
								<AuthLink href="/signup">Start Free</AuthLink>
							</Button>
							<Button size="lg" variant="outline" asChild>
								<Link href="/models">Browse models</Link>
							</Button>
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
