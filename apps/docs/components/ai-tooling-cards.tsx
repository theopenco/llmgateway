"use client";

import {
	ArrowRight,
	Bot,
	FileText,
	Plug,
	ScrollText,
	Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";

import type { ReactNode } from "react";

interface Tool {
	title: string;
	description: string;
	href: string;
	icon: ReactNode;
}

const tools: Tool[] = [
	{
		title: "llms.txt",
		description:
			"Machine-readable index of all documentation pages for LLM consumption.",
		href: "/llms.txt",
		icon: <FileText className="size-5" />,
	},
	{
		title: "llms-full.txt",
		description:
			"Complete documentation content in a single file for full-context LLM ingestion.",
		href: "/llms-full.txt",
		icon: <ScrollText className="size-5" />,
	},
	{
		title: "MCP Server",
		description:
			"Use LLM Gateway as an MCP server for Claude Code, Cursor, and other MCP-compatible clients.",
		href: "/guides/mcp",
		icon: <Plug className="size-5" />,
	},
	{
		title: "Agent Skills",
		description:
			"Packaged instructions and guidelines for AI coding agents to generate higher-quality code.",
		href: "/guides/agent-skills",
		icon: <Sparkles className="size-5" />,
	},
	{
		title: "Templates & Agents",
		description:
			"Pre-built templates and agent configurations to get started quickly.",
		href: "https://llmgateway.io/templates",
		icon: <Bot className="size-5" />,
	},
];

export function AIToolingCards() {
	const posthog = usePostHog();

	return (
		<div className="not-prose grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{tools.map((tool) => (
				<Link
					key={tool.href}
					href={tool.href}
					onClick={() => {
						posthog.capture("docs_ai_tooling_card_click", {
							tool: tool.title,
							href: tool.href,
						});
					}}
					className="group relative flex flex-col gap-3 rounded-xl border border-fd-border bg-fd-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-fd-primary/40"
				>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="rounded-lg bg-fd-primary/10 p-2 text-fd-primary transition-colors duration-200 group-hover:bg-fd-primary/20">
								{tool.icon}
							</div>
							<h3 className="text-sm font-semibold tracking-tight text-fd-foreground">
								{tool.title}
							</h3>
						</div>
						<ArrowRight className="size-4 -translate-x-1 text-fd-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-hover:text-fd-primary" />
					</div>
					<p className="text-[13px] leading-relaxed text-fd-muted-foreground">
						{tool.description}
					</p>
				</Link>
			))}
		</div>
	);
}
