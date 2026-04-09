"use client";

import { useState } from "react";

import {
	AnthropicIcon,
	AutohandIcon,
	ClineIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";

type Tool = "claude-code" | "soulforge" | "autohand" | "opencode" | "cline";

const tools: { id: Tool; name: string; icon: typeof AnthropicIcon }[] = [
	{ id: "claude-code", name: "Claude Code", icon: AnthropicIcon },
	{ id: "soulforge", name: "SoulForge", icon: SoulForgeIcon },
	{ id: "autohand", name: "Autohand", icon: AutohandIcon },
	{ id: "opencode", name: "OpenCode", icon: OpenCodeIcon },
	{ id: "cline", name: "Cline", icon: ClineIcon },
];

const snippets: Record<
	Tool,
	{
		lines: { prefix?: string; key: string; value: string }[];
		command: string;
		comment: string;
		modelLine?: { key: string; value: string };
	}
> = {
	"claude-code": {
		lines: [
			{
				key: "ANTHROPIC_BASE_URL=",
				value: "https://api.llmgateway.io",
			},
			{
				key: "ANTHROPIC_AUTH_TOKEN=",
				value: "llmgtwy_your_key",
			},
		],
		command: "claude",
		comment: "# works with any model — switch freely",
		modelLine: { key: "ANTHROPIC_MODEL=", value: "gpt-5" },
	},
	soulforge: {
		lines: [],
		command: "soulforge",
		comment: "# type /keys to set your LLM Gateway key — saves ~50% tokens",
	},
	autohand: {
		lines: [
			{
				key: "OPENAI_BASE_URL=",
				value: "https://api.llmgateway.io/v1",
			},
			{
				key: "OPENAI_API_KEY=",
				value: "llmgtwy_your_key",
			},
		],
		command: "autohand",
		comment: "# works with any model — switch freely",
		modelLine: { key: "OPENAI_MODEL=", value: "claude-opus-4-6" },
	},
	opencode: {
		lines: [
			{
				key: "OPENAI_BASE_URL=",
				value: "https://api.llmgateway.io/v1",
			},
			{
				key: "OPENAI_API_KEY=",
				value: "llmgtwy_your_key",
			},
		],
		command: "opencode",
		comment: "# works with any model — switch freely",
		modelLine: { key: "OPENAI_MODEL=", value: "claude-sonnet-4-20250514" },
	},
	cline: {
		lines: [
			{
				key: "OPENAI_BASE_URL=",
				value: "https://api.llmgateway.io/v1",
			},
			{
				key: "OPENAI_API_KEY=",
				value: "llmgtwy_your_key",
			},
		],
		command: "cline",
		comment: "# works with any model — switch freely",
		modelLine: { key: "OPENAI_MODEL=", value: "gpt-5" },
	},
};

export function TerminalPreview() {
	const [activeTool, setActiveTool] = useState<Tool>("claude-code");
	const snippet = snippets[activeTool];

	return (
		<>
			{/* Terminal preview */}
			<div className="mx-auto mt-16 max-w-2xl px-4 sm:px-0">
				<div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-lg">
					<div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
						<div className="flex gap-1.5">
							<div className="h-3 w-3 rounded-full bg-muted-foreground/20" />
							<div className="h-3 w-3 rounded-full bg-muted-foreground/20" />
							<div className="h-3 w-3 rounded-full bg-muted-foreground/20" />
						</div>
						<span className="ml-2 text-xs text-muted-foreground font-mono">
							terminal
						</span>
					</div>
					<div className="p-4 sm:p-5 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto">
						{snippet.lines.map((line) => (
							<div
								key={line.key}
								className="mt-1 first:mt-0 text-muted-foreground whitespace-nowrap"
							>
								<span className="text-foreground/70">$</span> export {line.key}
								<span className="text-foreground">{line.value}</span>
							</div>
						))}
						<div className="mt-1 text-muted-foreground">
							<span className="text-foreground/70">$</span> {snippet.command}
						</div>
						<div className="mt-3 text-muted-foreground/60">
							{snippet.comment}
						</div>
						{snippet.modelLine && (
							<div className="mt-1 text-muted-foreground whitespace-nowrap">
								<span className="text-foreground/70">$</span> export{" "}
								{snippet.modelLine.key}
								<span className="text-foreground">
									{snippet.modelLine.value}
								</span>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Compatible tools */}
			<div className="mt-16 border-y border-border/40 bg-muted/30 py-10">
				<div className="container mx-auto px-4">
					<div className="flex flex-col items-center gap-6">
						<span className="text-sm text-muted-foreground">Works with</span>
						<div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
							{tools.map((tool) => (
								<button
									key={tool.id}
									type="button"
									onClick={() => setActiveTool(tool.id)}
									className={`flex items-center gap-2.5 transition-colors cursor-pointer ${
										activeTool === tool.id
											? "text-foreground"
											: "text-muted-foreground hover:text-foreground/70"
									}`}
								>
									<tool.icon className="h-5 w-5" />
									<span className="text-sm font-medium">{tool.name}</span>
								</button>
							))}
						</div>
						<span className="text-xs text-muted-foreground">
							+ any OpenAI-compatible tool
						</span>
					</div>
				</div>
			</div>
		</>
	);
}
