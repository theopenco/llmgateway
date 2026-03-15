"use client";

import {
	ArrowUpRight,
	Bot,
	CloudSun,
	Code2,
	Copy,
	Check,
	FileText,
	Github,
	Mail,
	ScanText,
	SmilePlus,
	UserSearch,
	Wrench,
	Zap,
} from "lucide-react";
import { useState, useCallback } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";

interface Agent {
	name: string;
	description: string;
	href: string;
	icon: typeof Bot;
	capabilities: string[];
	tags: string[];
	gradient: string;
	featured?: boolean;
}

const agents: Agent[] = [
	{
		name: "Weather Agent",
		description:
			"An intelligent AI agent that provides real-time weather information using tool calling. Demonstrates function calling patterns with LLM Gateway.",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/agents/weather-agent",
		icon: CloudSun,
		capabilities: ["Tool Calling", "Real-time Data", "Natural Language"],
		tags: ["TypeScript", "AI SDK", "OpenAI"],
		gradient: "from-sky-500/20 via-cyan-500/20 to-teal-500/20",
		featured: true,
	},
	{
		name: "Lead Agent",
		description:
			"A CLI AI agent that researches a person by name or email and produces a structured profile summary including bio, role, background, and social links. Optionally posts results to Discord via webhook.",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/agents/lead-agent",
		icon: UserSearch,
		capabilities: ["Web Search", "Profile Research", "Discord Integration"],
		tags: ["TypeScript", "AI SDK", "Perplexity"],
		gradient: "from-violet-500/20 via-purple-500/20 to-fuchsia-500/20",
	},
	{
		name: "Changelog Generator",
		description:
			"Generates structured changelogs from git history using the Keep a Changelog format. Analyzes git log and diff with tools to produce categorized output (Added, Changed, Fixed).",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/agents/changelog-generator-agent",
		icon: FileText,
		capabilities: ["Tool Calling", "Git Analysis", "Structured Output"],
		tags: ["TypeScript", "AI SDK", "Zod"],
		gradient: "from-amber-500/20 via-orange-500/20 to-red-500/20",
	},
	{
		name: "Email Drafter",
		description:
			"Drafts polished emails from rough notes or bullet points with configurable tone. Returns structured output with subject, body, and sign-off.",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/agents/email-drafter-agent",
		icon: Mail,
		capabilities: ["Structured Output", "Tone Control", "Text Generation"],
		tags: ["TypeScript", "AI SDK", "Zod"],
		gradient: "from-blue-500/20 via-indigo-500/20 to-violet-500/20",
	},
	{
		name: "Sentiment Analyzer",
		description:
			"Analyzes text sentiment with confidence scores and key phrase extraction. Supports direct text input or file paths and classifies as positive, negative, neutral, or mixed.",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/agents/sentiment-analyzer-agent",
		icon: SmilePlus,
		capabilities: ["Sentiment Analysis", "Key Phrases", "File Input"],
		tags: ["TypeScript", "AI SDK", "Zod"],
		gradient: "from-emerald-500/20 via-green-500/20 to-teal-500/20",
	},
	{
		name: "Data Extractor",
		description:
			"Extracts structured entities from unstructured text including people, organizations, dates, monetary amounts, locations, emails, and phone numbers.",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/agents/data-extractor-agent",
		icon: ScanText,
		capabilities: ["Entity Extraction", "Structured Output", "NLP"],
		tags: ["TypeScript", "AI SDK", "Zod"],
		gradient: "from-rose-500/20 via-pink-500/20 to-fuchsia-500/20",
	},
];

export function AgentCards() {
	const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

	const copyToClipboard = useCallback((url: string) => {
		const templateName = url.split("/").pop();
		void navigator.clipboard.writeText(
			`npx @llmgateway/cli init --template ${templateName}`,
		);
		setCopiedUrl(url);
		setTimeout(() => setCopiedUrl(null), 2000);
	}, []);

	if (agents.length === 0) {
		return (
			<div className="text-center py-16">
				<Bot className="mx-auto h-12 w-12 text-muted-foreground/50" />
				<p className="mt-4 text-muted-foreground">
					Agents coming soon. Check back later!
				</p>
			</div>
		);
	}

	return (
		<div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-2 max-w-5xl mx-auto">
			{agents.map((agent) => (
				<Card
					key={agent.name}
					className="group relative overflow-hidden border-0 bg-gradient-to-br from-background to-muted/30 shadow-xl hover:shadow-2xl transition-all duration-500"
				>
					{/* Gradient overlay */}
					<div
						className={`absolute inset-0 bg-gradient-to-br ${agent.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
					/>

					{/* Featured badge */}
					{agent.featured && (
						<div className="absolute top-4 right-4 z-10">
							<Badge className="bg-gradient-to-r from-sky-600 to-cyan-600 text-white border-0 shadow-lg">
								<Zap className="mr-1 h-3 w-3" />
								Featured
							</Badge>
						</div>
					)}

					<div className="relative p-6 space-y-6">
						{/* Icon with animated background */}
						<div className="relative">
							<div className="absolute inset-0 bg-gradient-to-br from-sky-500 to-cyan-500 rounded-2xl blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
							<div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-500 shadow-lg">
								<agent.icon className="h-8 w-8 text-white" />
							</div>
						</div>

						{/* Content */}
						<div className="space-y-3">
							<h3 className="text-2xl font-bold tracking-tight">
								{agent.name}
							</h3>
							<p className="text-muted-foreground leading-relaxed">
								{agent.description}
							</p>
						</div>

						{/* Capabilities */}
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
								<Wrench className="h-4 w-4" />
								Capabilities
							</div>
							<div className="flex flex-wrap gap-2">
								{agent.capabilities.map((capability) => (
									<Badge
										key={capability}
										variant="outline"
										className="bg-background/50 border-sky-500/30 text-sky-600 dark:text-sky-400"
									>
										{capability}
									</Badge>
								))}
							</div>
						</div>

						{/* Tech Stack */}
						<div className="flex flex-wrap gap-2">
							{agent.tags.map((tag) => (
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
						<div className="flex flex-col sm:flex-row gap-3 pt-2">
							<Button asChild className="flex-1 gap-2 font-semibold">
								<a href={agent.href} target="_blank" rel="noopener noreferrer">
									<Github className="h-4 w-4" />
									View on GitHub
									<ArrowUpRight className="h-4 w-4 opacity-50 group-hover:opacity-100 transition-opacity" />
								</a>
							</Button>
							<Button
								variant="outline"
								className="gap-2"
								onClick={() => copyToClipboard(agent.href)}
							>
								{copiedUrl === agent.href ? (
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
					<div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 via-cyan-500 to-teal-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
				</Card>
			))}

			{/* Placeholder card for upcoming agents */}
			<Card className="relative overflow-hidden border-dashed border-2 bg-muted/20 hover:bg-muted/30 transition-colors duration-300">
				<div className="p-6 space-y-6 flex flex-col items-center justify-center min-h-[400px] text-center">
					<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
						<Bot className="h-8 w-8 text-muted-foreground" />
					</div>
					<div className="space-y-2">
						<h3 className="text-xl font-semibold text-muted-foreground">
							More Agents Coming Soon
						</h3>
						<p className="text-sm text-muted-foreground/80 max-w-xs">
							We&apos;re building more agents with different capabilities. Have
							an idea?
						</p>
					</div>
					<Button variant="outline" asChild>
						<a
							href="https://github.com/theopenco/llmgateway-templates/issues/new"
							target="_blank"
							rel="noopener noreferrer"
						>
							Request an Agent
						</a>
					</Button>
				</div>
			</Card>
		</div>
	);
}
