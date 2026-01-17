import { Code, Wrench, Zap, Braces } from "lucide-react";
import Link from "next/link";

import { CodingModelsShowcase } from "@/components/CodingModelsShowcase";
import { Button } from "@/components/ui/button";
import { getConfig } from "@/lib/config-server";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "AI Models for Coding - LLM Gateway Code",
	description:
		"High-performance AI models optimized for coding tasks with tool support, JSON output, streaming, and prompt caching.",
};

export default function CodingModelsPage() {
	const config = getConfig();

	return (
		<div className="min-h-screen bg-background">
			<header className="border-b">
				<div className="container mx-auto px-4 py-4 flex items-center justify-between">
					<Link href="/" className="flex items-center gap-2">
						<Code className="h-6 w-6" />
						<span className="font-semibold text-lg">LLM Gateway Code</span>
					</Link>
					<div className="flex items-center gap-4">
						<Button variant="ghost" asChild>
							<Link href="/login">Sign in</Link>
						</Button>
						<Button asChild>
							<Link href="/signup">Get Started</Link>
						</Button>
					</div>
				</div>
			</header>

			<main>
				<section className="py-20 px-4">
					<div className="container mx-auto text-center max-w-4xl">
						<h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
							AI Models for
							<span className="text-primary"> Coding</span>
						</h1>
						<p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
							High-performance models optimized for coding tasks. All models
							support tool calling, JSON output, streaming, and prompt caching.
						</p>
						<div className="flex gap-4 justify-center">
							<Button size="lg" asChild>
								<Link href="/signup">Get Started</Link>
							</Button>
							<Button size="lg" variant="outline" asChild>
								<Link href="/#pricing">View Pricing</Link>
							</Button>
						</div>
					</div>
				</section>

				<section className="py-16 px-4 bg-muted/50">
					<div className="container mx-auto">
						<div className="grid md:grid-cols-4 gap-6 max-w-4xl mx-auto mb-12">
							<div className="text-center">
								<div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
									<Wrench className="h-6 w-6 text-primary" />
								</div>
								<h3 className="font-semibold mb-2">Tool Calling</h3>
								<p className="text-sm text-muted-foreground">
									Execute code, run commands, and interact with external APIs.
								</p>
							</div>
							<div className="text-center">
								<div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
									<Braces className="h-6 w-6 text-primary" />
								</div>
								<h3 className="font-semibold mb-2">JSON Output</h3>
								<p className="text-sm text-muted-foreground">
									Structured responses for seamless integration with your tools.
								</p>
							</div>
							<div className="text-center">
								<div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
									<Zap className="h-6 w-6 text-primary" />
								</div>
								<h3 className="font-semibold mb-2">Streaming</h3>
								<p className="text-sm text-muted-foreground">
									Real-time responses for faster feedback during development.
								</p>
							</div>
							<div className="text-center">
								<div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
									<Code className="h-6 w-6 text-primary" />
								</div>
								<h3 className="font-semibold mb-2">Prompt Caching</h3>
								<p className="text-sm text-muted-foreground">
									Reduce costs and latency with intelligent prompt caching.
								</p>
							</div>
						</div>
					</div>
				</section>

				<section className="py-16 px-4">
					<div className="container mx-auto max-w-6xl">
						<h2 className="text-2xl font-bold text-center mb-8">
							Featured Coding Models
						</h2>
						<CodingModelsShowcase uiUrl={config.uiUrl} showCTA />
					</div>
				</section>

				<section className="py-16 px-4 bg-muted/50">
					<div className="container mx-auto text-center max-w-2xl">
						<h2 className="text-3xl font-bold mb-4">
							Start coding with AI today
						</h2>
						<p className="text-muted-foreground mb-8">
							Subscribe to a Dev Plan and get access to all coding models with a
							single API key.
						</p>
						<div className="flex gap-4 justify-center">
							<Button size="lg" asChild>
								<Link href="/signup">Sign up for a Dev Plan</Link>
							</Button>
						</div>
					</div>
				</section>
			</main>
		</div>
	);
}
