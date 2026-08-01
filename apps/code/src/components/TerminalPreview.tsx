"use client";

import { useState } from "react";

import {
	AnthropicIcon,
	AutohandIcon,
	ClineIcon,
	DevPassCodeIcon,
	EmpryoIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";

type Tool =
	| "devpass-code"
	| "claude-code"
	| "empryo"
	| "soulforge"
	| "autohand"
	| "opencode"
	| "cline";

const tools: {
	id: Tool;
	name: string;
	icon: typeof AnthropicIcon;
	highlight?: string;
}[] = [
	{
		id: "devpass-code",
		name: "DevPass Code",
		icon: DevPassCodeIcon,
		highlight: "First-party",
	},
	{ id: "claude-code", name: "Claude Code", icon: AnthropicIcon },
	{ id: "opencode", name: "OpenCode", icon: OpenCodeIcon },
	{
		id: "empryo",
		name: "Empryo",
		icon: EmpryoIcon,
	},
	{
		id: "soulforge",
		name: "SoulForge",
		icon: SoulForgeIcon,
	},
	{ id: "autohand", name: "Autohand", icon: AutohandIcon },
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
	"devpass-code": {
		lines: [],
		command: "devpass-code auth login",
		comment: "# opens your browser — no keys to copy, models built in",
	},
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
	empryo: {
		lines: [],
		command: "empryo",
		comment:
			"# inside: /keys → paste your DevPass key (or: empryo --set-key llmgateway <key>)",
	},
	soulforge: {
		lines: [],
		command: "soulforge",
		comment:
			"# inside: /keys → paste your DevPass key (or: soulforge --set-key llmgateway <key>)",
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
		modelLine: { key: "OPENAI_MODEL=", value: "claude-opus-4-8" },
	},
	opencode: {
		lines: [],
		command: "opencode",
		comment: "# LLM Gateway is built-in — type /connect to link your key",
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
	const [activeTool, setActiveTool] = useState<Tool>("devpass-code");
	const snippet = snippets[activeTool];

	return (
		<div className="w-full">
			<div className="mb-3 flex flex-wrap items-center gap-1.5">
				{tools.map((tool) => (
					<button
						key={tool.id}
						type="button"
						onClick={() => setActiveTool(tool.id)}
						className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-xs transition-colors ${
							activeTool === tool.id
								? "border-emerald-500/50 bg-emerald-500/10 text-foreground"
								: "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
						}`}
					>
						<tool.icon className="h-3.5 w-3.5" />
						{tool.name}
						{tool.highlight && (
							<span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
								{tool.highlight}
							</span>
						)}
					</button>
				))}
			</div>

			<div className="relative">
				<div
					aria-hidden
					className="absolute -inset-4 -z-10 rounded-3xl bg-emerald-500/10 blur-2xl"
				/>
				<div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/40">
					<div className="flex items-center gap-2 border-b border-zinc-800/80 px-4 py-3">
						<div className="flex gap-1.5">
							<div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
							<div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
							<div className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
						</div>
						<span className="ml-2 font-mono text-xs text-zinc-500">
							~ devpass
						</span>
						<span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-zinc-600">
							bash
						</span>
					</div>
					<div className="min-h-[190px] overflow-x-auto p-4 font-mono text-xs leading-relaxed sm:p-5 sm:text-sm">
						{snippet.lines.map((line) => (
							<div
								key={line.key}
								className="mt-1 whitespace-nowrap text-zinc-500 first:mt-0"
							>
								<span className="text-emerald-400">$</span> export {line.key}
								<span className="text-zinc-100">{line.value}</span>
							</div>
						))}
						<div className="mt-1 text-zinc-500 first:mt-0">
							<span className="text-emerald-400">$</span>{" "}
							<span className="text-zinc-100">{snippet.command}</span>
						</div>
						<div className="mt-3 text-zinc-600">{snippet.comment}</div>
						{snippet.modelLine && (
							<div className="mt-1 whitespace-nowrap text-zinc-500">
								<span className="text-emerald-400">$</span> export{" "}
								{snippet.modelLine.key}
								<span className="text-zinc-100">{snippet.modelLine.value}</span>
							</div>
						)}
						<div className="mt-3 text-zinc-500">
							<span className="text-emerald-400">$</span>{" "}
							<span className="inline-block h-3.5 w-2 translate-y-0.5 animate-pulse bg-emerald-400/80" />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
