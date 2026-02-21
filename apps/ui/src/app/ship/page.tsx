import Link from "next/link";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Ship an AI App in 10 Minutes | LLM Gateway",
	description:
		"Clone a production-ready AI template, connect to 300+ models, and deploy. Ship your AI app in minutes with LLM Gateway.",
	openGraph: {
		title: "Ship an AI App in 10 Minutes | LLM Gateway",
		description:
			"Clone a production-ready AI template, connect to 300+ models, and deploy. Ship your AI app in minutes with LLM Gateway.",
	},
};

const templates = [
	{
		name: "AI Chatbot",
		description:
			"Streaming chat with conversation history and model switching.",
		command: "npx @llmgateway/cli init --template ai-chatbot",
		tags: ["Next.js", "AI SDK", "Streaming"],
	},
	{
		name: "Image Generation",
		description:
			"Generate images with DALL-E, Stable Diffusion, and more through a unified API.",
		command: "npx @llmgateway/cli init --template image-generation",
		tags: ["Next.js", "AI SDK", "Multi-provider"],
	},
	{
		name: "Writing Assistant",
		description:
			"Text actions including rewrite, summarize, expand, and tone adjustment.",
		command: "npx @llmgateway/cli init --template writing-assistant",
		tags: ["Next.js", "AI SDK", "Structured Output"],
	},
	{
		name: "Feedback Dashboard",
		description:
			"Sentiment analysis dashboard with batch AI analysis and key theme extraction.",
		command: "npx @llmgateway/cli init --template feedback-dashboard",
		tags: ["Next.js", "AI SDK", "Analytics"],
	},
	{
		name: "OG Image Generator",
		description:
			"AI-powered Open Graph image generator with live preview and themes.",
		command: "npx @llmgateway/cli init --template og-image-generator",
		tags: ["Next.js", "AI SDK", "Structured Output"],
	},
	{
		name: "QA Agent",
		description:
			"AI-powered QA testing agent with browser automation and real-time action timeline.",
		command: "npx @llmgateway/cli init --template qa-agent",
		tags: ["Next.js", "AI SDK", "Browser Automation"],
	},
];

const steps = [
	{
		number: "1",
		title: "Install the CLI",
		description: "One command to get the LLM Gateway CLI.",
		code: "npm i -g @llmgateway/cli",
	},
	{
		number: "2",
		title: "Choose a Template",
		description: "Pick a template and clone it instantly.",
		code: "npx @llmgateway/cli init --template ai-chatbot",
	},
	{
		number: "3",
		title: "Add Your API Key & Deploy",
		description: "Set your LLM Gateway API key and ship it.",
		code: 'echo "LLMGATEWAY_API_KEY=your_key" > .env.local && npm run dev',
	},
];

export default function ShipPage() {
	return (
		<div>
			<HeroRSC navbarOnly />

			{/* Hero */}
			<section className="py-20 sm:py-28">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-2xl text-center mb-16">
						<h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
							Ship an AI App in 10 Minutes
						</h1>
						<p className="text-lg text-muted-foreground leading-relaxed">
							Production-ready templates powered by LLM Gateway. Clone,
							configure, and deploy — with access to 300+ models from every
							major provider.
						</p>
						<div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
							<Link
								href="/signup"
								className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
							>
								Get Started Free
							</Link>
							<Link
								href="/templates"
								className="inline-flex items-center justify-center rounded-md border border-input bg-background px-6 py-3 text-sm font-semibold shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
							>
								Browse Templates
							</Link>
						</div>
					</div>
				</div>
			</section>

			{/* Steps */}
			<section className="py-16 bg-muted/30">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-3xl">
						<h2 className="text-3xl font-bold tracking-tight text-center mb-12">
							Three Steps to Production
						</h2>
						<div className="space-y-8">
							{steps.map((step) => (
								<div key={step.number} className="flex gap-6">
									<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg">
										{step.number}
									</div>
									<div className="flex-1 space-y-2">
										<h3 className="text-xl font-semibold">{step.title}</h3>
										<p className="text-muted-foreground">{step.description}</p>
										<pre className="mt-2 overflow-x-auto rounded-lg bg-background border p-4 text-sm">
											<code>{step.code}</code>
										</pre>
									</div>
								</div>
							))}
						</div>
					</div>
				</div>
			</section>

			{/* Templates */}
			<section className="py-20">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-2xl text-center mb-12">
						<h2 className="text-3xl font-bold tracking-tight mb-4">
							Pick a Template
						</h2>
						<p className="text-lg text-muted-foreground">
							Each template is a complete Next.js application with AI features
							built in. Clone and customize.
						</p>
					</div>
					<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
						{templates.map((template) => (
							<div
								key={template.name}
								className="group rounded-xl border bg-card p-6 shadow-sm hover:shadow-md transition-shadow space-y-4"
							>
								<div>
									<h3 className="text-lg font-semibold">{template.name}</h3>
									<p className="mt-1 text-sm text-muted-foreground">
										{template.description}
									</p>
								</div>
								<div className="flex flex-wrap gap-1.5">
									{template.tags.map((tag) => (
										<span
											key={tag}
											className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
										>
											{tag}
										</span>
									))}
								</div>
								<pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs">
									<code>{template.command}</code>
								</pre>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* CTA */}
			<section className="py-20 bg-muted/30">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-2xl text-center space-y-6">
						<h2 className="text-3xl font-bold tracking-tight">
							Ready to Ship?
						</h2>
						<p className="text-lg text-muted-foreground">
							Create a free LLM Gateway account, grab an API key, and start
							building with any of our 300+ supported models.
						</p>
						<div className="flex flex-col sm:flex-row gap-4 justify-center">
							<Link
								href="/signup"
								className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
							>
								Create Free Account
							</Link>
							<Link
								href="/models"
								className="inline-flex items-center justify-center rounded-md border border-input bg-background px-6 py-3 text-sm font-semibold shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
							>
								Explore Models
							</Link>
						</div>
					</div>
				</div>
			</section>

			<Footer />
		</div>
	);
}
