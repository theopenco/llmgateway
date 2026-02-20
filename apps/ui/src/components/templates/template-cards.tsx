"use client";

import {
	ArrowUpRight,
	Code2,
	Copy,
	Check,
	ExternalLink,
	Image as ImageIcon,
	MessageSquare,
	PanelTop,
	BarChart3,
	PenLine,
	ShieldCheck,
	Sparkles,
	Github,
	Play,
} from "lucide-react";
import Image from "next/image";
import { useState, useCallback } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";

interface Template {
	name: string;
	description: string;
	href: string;
	demoUrl: string;
	demoLabel?: string;
	image: string;
	icon: typeof ImageIcon;
	tags: string[];
	gradient: string;
	featured?: boolean;
}

const templates: Template[] = [
	{
		name: "Image Generation",
		description:
			"Generate stunning images with AI using multiple providers. Supports DALL-E, Stable Diffusion, and more through a unified API.",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/templates/image-generation",
		demoUrl: "https://llm-image-generation.vercel.app",
		image: "/templates/image-gen.png",
		icon: ImageIcon,
		tags: ["TypeScript", "Next.js", "AI SDK"],
		gradient: "from-violet-500/20 via-fuchsia-500/20 to-pink-500/20",
		featured: true,
	},
	{
		name: "AI Chatbot",
		description:
			"Streaming chat interface with conversation history and model selector. Switch between LLM providers on the fly with real-time token delivery.",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/templates/ai-chatbot",
		demoUrl: "https://llm-ai-chatbot-brown.vercel.app",
		image: "/templates/chatbot.png",
		icon: MessageSquare,
		tags: ["TypeScript", "Next.js", "AI SDK"],
		gradient: "from-sky-500/20 via-blue-500/20 to-indigo-500/20",
		featured: true,
	},
	{
		name: "OG Image Generator",
		description:
			"AI-powered Open Graph image generator with live preview, multiple themes, and one-click download. Uses structured output to generate title, subtitle, and call-to-action copy.",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/templates/og-image-generator",
		demoUrl: "https://llm-og-image-generator.vercel.app",
		image: "/templates/og-image.png",
		icon: PanelTop,
		tags: ["TypeScript", "Next.js", "AI SDK"],
		gradient: "from-orange-500/20 via-amber-500/20 to-yellow-500/20",
	},
	{
		name: "Feedback Dashboard",
		description:
			"Customer feedback sentiment analysis dashboard. Paste reviews for batch AI analysis with sentiment scores, key themes extraction, and individual review breakdowns.",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/templates/feedback-dashboard",
		demoUrl: "https://llm-feedback-dashboard.vercel.app",
		image: "/templates/feedback.png",
		icon: BarChart3,
		tags: ["TypeScript", "Next.js", "AI SDK"],
		gradient: "from-emerald-500/20 via-green-500/20 to-teal-500/20",
	},
	{
		name: "Writing Assistant",
		description:
			"AI writing assistant with text actions including rewrite, summarize, expand, fix grammar, and change tone. Supports multiple tone presets from professional to academic.",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/templates/writing-assistant",
		demoUrl: "https://llm-writing-assistant.vercel.app",
		image: "/templates/writing-assistant.png",
		icon: PenLine,
		tags: ["TypeScript", "Next.js", "AI SDK"],
		gradient: "from-rose-500/20 via-pink-500/20 to-fuchsia-500/20",
	},
	{
		name: "QA Agent",
		description:
			"AI-powered QA testing agent that uses browser automation to interact with your running web app. Describe tests in plain English and watch it execute step-by-step with a real-time action timeline.",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/templates/qa-agent",
		demoUrl: "https://youtu.be/-ai9eVvXvZE",
		demoLabel: "Watch Demo",
		image: "/templates/qa-agent.png",
		icon: ShieldCheck,
		tags: ["TypeScript", "Next.js", "AI SDK"],
		gradient: "from-cyan-500/20 via-teal-500/20 to-blue-500/20",
	},
];

export function TemplateCards() {
	const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

	const copyToClipboard = useCallback((url: string) => {
		const templateName = url.split("/").pop();
		void navigator.clipboard.writeText(
			`npx @llmgateway/cli init --template ${templateName}`,
		);
		setCopiedUrl(url);
		setTimeout(() => setCopiedUrl(null), 2000);
	}, []);

	if (templates.length === 0) {
		return (
			<div className="text-center py-16">
				<Sparkles className="mx-auto h-12 w-12 text-muted-foreground/50" />
				<p className="mt-4 text-muted-foreground">
					Templates coming soon. Check back later!
				</p>
			</div>
		);
	}

	return (
		<div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-2 max-w-5xl mx-auto">
			{templates.map((template) => (
				<Card
					key={template.name}
					className="group relative flex flex-col overflow-hidden border-0 bg-gradient-to-br from-background to-muted/30 shadow-xl hover:shadow-2xl transition-all duration-500"
				>
					{/* Gradient overlay */}
					<div
						className={`absolute inset-0 bg-gradient-to-br ${template.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
					/>

					{/* Featured badge */}
					{template.featured && (
						<div className="absolute top-4 right-4 z-10">
							<Badge className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white border-0 shadow-lg">
								<Sparkles className="mr-1 h-3 w-3" />
								Featured
							</Badge>
						</div>
					)}

					{/* Preview image */}
					<div className="relative aspect-video overflow-hidden">
						<Image
							src={template.image}
							alt={`${template.name} preview`}
							width={1200}
							height={675}
							className="h-full w-full object-cover"
						/>
						<div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
					</div>

					<div className="relative flex flex-1 flex-col p-6 space-y-6">
						{/* Content */}
						<div className="space-y-3">
							<div className="flex items-center gap-3">
								<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg">
									<template.icon className="h-5 w-5 text-white" />
								</div>
								<h3 className="text-2xl font-bold tracking-tight">
									{template.name}
								</h3>
							</div>
							<p className="text-muted-foreground leading-relaxed">
								{template.description}
							</p>
						</div>

						{/* Tags */}
						<div className="flex flex-wrap gap-2">
							{template.tags.map((tag) => (
								<Badge
									key={tag}
									variant="secondary"
									className="bg-muted/80 hover:bg-muted transition-colors"
								>
									<Code2 className="mr-1 h-3 w-3" />
									{tag}
								</Badge>
							))}
						</div>

						{/* Actions */}
						<div className="flex flex-col sm:flex-row gap-3 pt-2 mt-auto">
							<Button asChild className="flex-1 gap-2 font-semibold">
								<a
									href={template.demoUrl}
									target="_blank"
									rel="noopener noreferrer"
								>
									{template.demoLabel ? (
										<Play className="h-4 w-4" />
									) : (
										<ExternalLink className="h-4 w-4" />
									)}
									{template.demoLabel ?? "Live Demo"}
									<ArrowUpRight className="h-4 w-4 opacity-50 group-hover:opacity-100 transition-opacity" />
								</a>
							</Button>
							<Button variant="outline" asChild className="gap-2">
								<a
									href={template.href}
									target="_blank"
									rel="noopener noreferrer"
								>
									<Github className="h-4 w-4" />
									GitHub
								</a>
							</Button>
							<Button
								variant="outline"
								className="gap-2"
								onClick={() => copyToClipboard(template.href)}
							>
								{copiedUrl === template.href ? (
									<>
										<Check className="h-4 w-4 text-green-500" />
										Copied!
									</>
								) : (
									<>
										<Copy className="h-4 w-4" />
										Clone
									</>
								)}
							</Button>
						</div>
					</div>

					{/* Bottom accent line */}
					<div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
				</Card>
			))}

			{/* Placeholder card for upcoming templates */}
			<Card className="relative overflow-hidden border-dashed border-2 bg-muted/20 hover:bg-muted/30 transition-colors duration-300">
				<div className="p-6 space-y-6 flex flex-col items-center justify-center min-h-[320px] text-center">
					<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
						<Sparkles className="h-8 w-8 text-muted-foreground" />
					</div>
					<div className="space-y-2">
						<h3 className="text-xl font-semibold text-muted-foreground">
							More Coming Soon
						</h3>
						<p className="text-sm text-muted-foreground/80">
							We&apos;re working on more templates. Have a suggestion?
						</p>
					</div>
					<Button variant="outline" asChild>
						<a
							href="https://github.com/theopenco/llmgateway-templates/issues/new"
							target="_blank"
							rel="noopener noreferrer"
						>
							Request a Template
						</a>
					</Button>
				</div>
			</Card>
		</div>
	);
}
