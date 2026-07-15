import { Check, GitFork, Lock, ServerCog, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { CompareFaq } from "@/components/compare/compare-faq";
import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import { AuthLink } from "@/components/shared/auth-link";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const reasons = [
	{
		icon: Lock,
		title: "No vendor lock-in",
		description:
			"The whole platform is AGPLv3. Fork it, audit it, and run it forever — no proprietary control plane you can be cut off from.",
	},
	{
		icon: ServerCog,
		title: "Self-host the full stack",
		description:
			"Gateway, dashboard, and worker ship in a single Docker image. Keep every request and key inside your own infrastructure.",
	},
	{
		icon: ShieldCheck,
		title: "Data residency by default",
		description:
			"For regulated and privacy-sensitive teams, requests never have to leave your network or pass through a third party.",
	},
	{
		icon: GitFork,
		title: "Inspect and extend",
		description:
			"Read the code, open a PR, or bend it to your stack. An LLM API gateway you can actually change beats one you can only call.",
	},
];

const openSourceFaqs: CompareFaqItem[] = [
	{
		question: "Is LLM Gateway really open source?",
		answer:
			"Yes. The entire platform — gateway, API, dashboard, and worker — is licensed under AGPLv3 and free to self-host forever. Most alternatives only open-source a thin router, or nothing at all.",
	},
	{
		question: "What does the AGPLv3 license mean for my company?",
		answer:
			"You can run LLM Gateway internally and in production for free. AGPLv3's source-availability requirement applies when you offer a modified version to others as a network service. For commercial terms outside AGPLv3, an enterprise license is available.",
	},
	{
		question: "How do I self-host the LLM gateway?",
		answer:
			"One Docker command runs the unified image with the gateway, dashboard, and worker. Point your OpenAI-compatible client at your own deployment and you are live — no managed account required.",
	},
	{
		question: "Is there a managed option too?",
		answer:
			"Yes. If you would rather not run infrastructure, the hosted LLM API gateway is pay-as-you-go with a flat 5% platform fee on credits, or 0% when you bring your own provider keys.",
	},
	{
		question: "Which models does the open-source gateway support?",
		answer:
			"200+ models across 40+ providers — OpenAI, Anthropic, Google, Mistral, Llama and more — through one OpenAI-compatible endpoint, whether you self-host or use the managed service.",
	},
];

const closedComparison = [
	{ name: "LLM Gateway", scope: "Full platform (AGPLv3)", selfHost: true },
	{ name: "OpenRouter", scope: "Closed source", selfHost: false },
	{ name: "Vercel AI Gateway", scope: "Closed source", selfHost: false },
	{ name: "Cloudflare AI Gateway", scope: "Closed source", selfHost: false },
	{ name: "Portkey", scope: "Gateway + parts (MIT)", selfHost: "Partial" },
	{ name: "LiteLLM", scope: "Library/proxy (MIT)", selfHost: true },
];

export default function OpenSourcePage() {
	const softwareSchema = {
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "LLM Gateway",
		applicationCategory: "DeveloperApplication",
		operatingSystem: "Docker, Linux, macOS",
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "USD",
		},
		description:
			"Open source LLM API gateway. Route 200+ models across 40+ providers through one OpenAI-compatible endpoint. AGPLv3, self-hostable in one Docker command.",
		url: "https://llmgateway.io/open-source",
		license: "https://www.gnu.org/licenses/agpl-3.0.html",
	};

	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<JsonLd data={softwareSchema} />
			<Navbar />
			<main>
				<section className="relative overflow-hidden">
					<div className="mx-auto max-w-5xl px-6 pt-24 pb-12 md:pt-36 md:pb-20 text-center">
						<Badge variant="outline" className="mb-4">
							AGPLv3 · Self-hostable
						</Badge>
						<h1 className="text-4xl md:text-6xl font-bold tracking-tight text-balance">
							The Open Source LLM Gateway
						</h1>
						<p className="mx-auto mt-6 max-w-2xl text-base md:text-lg text-muted-foreground">
							Route 200+ models across 40+ providers through one
							OpenAI-compatible API — and run the entire platform on your own
							infrastructure. Open source, self-hostable, no lock-in.
						</p>
						<div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
							<Button size="lg" className="bg-primary hover:bg-primary/90">
								<AuthLink href="/signup">Start Free</AuthLink>
							</Button>
							<Button size="lg" variant="outline" asChild>
								<a
									href="https://github.com/theopenco/llmgateway"
									target="_blank"
									rel="noopener noreferrer"
								>
									Star on GitHub
								</a>
							</Button>
						</div>
					</div>
				</section>

				<section className="w-full py-12 md:py-20 bg-background">
					<div className="container px-4 md:px-6 max-w-5xl mx-auto">
						<div className="text-center mb-12">
							<h2 className="text-3xl font-bold tracking-tight mb-2">
								Why an open source AI gateway matters
							</h2>
							<p className="text-muted-foreground">
								The infrastructure routing every model call is too important to
								be a black box.
							</p>
						</div>
						<div className="grid gap-6 sm:grid-cols-2">
							{reasons.map((reason) => (
								<div
									key={reason.title}
									className="rounded-lg border border-border bg-card p-6"
								>
									<reason.icon className="h-6 w-6 text-primary mb-3" />
									<h3 className="font-semibold text-lg mb-1">{reason.title}</h3>
									<p className="text-sm text-muted-foreground">
										{reason.description}
									</p>
								</div>
							))}
						</div>
					</div>
				</section>

				<section className="w-full py-12 md:py-20 bg-muted/30">
					<div className="container px-4 md:px-6 max-w-3xl mx-auto">
						<div className="text-center mb-8">
							<h2 className="text-3xl font-bold tracking-tight mb-2">
								Self-host in one command
							</h2>
							<p className="text-muted-foreground">
								The gateway, dashboard, and worker in a single image.
							</p>
						</div>
						<pre className="overflow-x-auto rounded-lg border border-border bg-card p-4 text-sm">
							<code>{`docker run -d \\
  --name llmgateway \\
  -p 3002:3002 -p 4001:4001 -p 4002:4002 \\
  -e AUTH_SECRET="your-secret" \\
  -e GATEWAY_API_KEY_HASH_SECRET="your-hash-secret" \\
  ghcr.io/theopenco/llmgateway-unified:latest`}</code>
						</pre>
						<p className="text-center text-sm text-muted-foreground mt-4">
							Prefer not to run infrastructure? The{" "}
							<Link href="/pricing" className="underline">
								managed LLM API gateway
							</Link>{" "}
							is pay-as-you-go, or free with your own provider keys.
						</p>
					</div>
				</section>

				<section className="w-full py-12 md:py-20 bg-background">
					<div className="container px-4 md:px-6 max-w-3xl mx-auto">
						<div className="text-center mb-8">
							<h2 className="text-3xl font-bold tracking-tight mb-2">
								Open vs closed gateways
							</h2>
							<p className="text-muted-foreground">
								Most gateways open-source a router at best. LLM Gateway
								open-sources the whole platform.
							</p>
						</div>
						<div className="overflow-hidden rounded-lg border border-border">
							<table className="w-full text-sm">
								<thead className="bg-muted/50">
									<tr>
										<th className="px-4 py-3 text-left font-semibold">
											Gateway
										</th>
										<th className="px-4 py-3 text-left font-semibold">
											Open-source scope
										</th>
										<th className="px-4 py-3 text-center font-semibold">
											Self-host
										</th>
									</tr>
								</thead>
								<tbody>
									{closedComparison.map((row) => (
										<tr key={row.name} className="border-t border-border/60">
											<td className="px-4 py-3 font-medium">{row.name}</td>
											<td className="px-4 py-3 text-muted-foreground">
												{row.scope}
											</td>
											<td className="px-4 py-3 text-center">
												{row.selfHost === true ? (
													<Check className="inline h-4 w-4 text-green-600 dark:text-green-400" />
												) : row.selfHost === false ? (
													<span className="text-muted-foreground">No</span>
												) : (
													<span className="text-muted-foreground">
														{row.selfHost}
													</span>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<div className="mt-6 flex flex-wrap gap-3 justify-center text-sm">
							<Link href="/compare/open-router" className="underline">
								vs OpenRouter
							</Link>
							<Link href="/compare/vercel-ai-gateway" className="underline">
								vs Vercel AI Gateway
							</Link>
							<Link href="/compare/portkey" className="underline">
								vs Portkey
							</Link>
							<Link href="/compare/litellm" className="underline">
								vs LiteLLM
							</Link>
						</div>
					</div>
				</section>

				<CompareFaq
					heading="Open source LLM gateway FAQ"
					description="Licensing, self-hosting, and how the open-source build relates to the managed service."
					faqs={openSourceFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	const title = "Open Source LLM Gateway — Self-Hostable AI API Gateway";
	const description =
		"Open-source, self-hostable LLM API gateway. Route 200+ models across 40+ providers via one OpenAI-compatible endpoint under AGPLv3.";
	return {
		title,
		description,
		alternates: {
			canonical: "/open-source",
		},
		openGraph: {
			title,
			description,
			type: "website",
			url: "https://llmgateway.io/open-source",
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}
