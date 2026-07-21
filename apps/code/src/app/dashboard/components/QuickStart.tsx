"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import {
	AnthropicIcon,
	AutohandIcon,
	ClineIcon,
	EmpryoIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";

type ToolId =
	| "claude-code"
	| "opencode"
	| "empryo"
	| "soulforge"
	| "autohand"
	| "cline";

interface ToolDef {
	id: ToolId;
	name: string;
	icon: typeof AnthropicIcon;
	highlight?: string;
}

const TOOLS: ToolDef[] = [
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

interface EnvLine {
	key: string;
	value: string;
	secret?: boolean;
}

interface Snippet {
	exports: EnvLine[];
	command: string;
	comment: string;
}

function buildSnippets(apiKey: string): Record<ToolId, Snippet> {
	return {
		"claude-code": {
			exports: [
				{ key: "ANTHROPIC_BASE_URL", value: "https://api.llmgateway.io" },
				{ key: "ANTHROPIC_AUTH_TOKEN", value: apiKey, secret: true },
			],
			command: "claude",
			comment: "# works with any model — switch freely",
		},
		opencode: {
			exports: [],
			command: "opencode",
			comment: "# LLM Gateway is built-in — type /connect to link your key",
		},
		empryo: {
			exports: [],
			command: "empryo",
			comment:
				"# inside: /keys → paste your DevPass key (or: empryo --set-key llmgateway <key>)",
		},
		soulforge: {
			exports: [],
			command: "soulforge",
			comment:
				"# inside: /keys → paste your DevPass key (or: soulforge --set-key llmgateway <key>)",
		},
		autohand: {
			exports: [
				{ key: "OPENAI_BASE_URL", value: "https://api.llmgateway.io/v1" },
				{ key: "OPENAI_API_KEY", value: apiKey, secret: true },
			],
			command: "autohand",
			comment: "# works with any model — switch freely",
		},
		cline: {
			exports: [
				{ key: "OPENAI_BASE_URL", value: "https://api.llmgateway.io/v1" },
				{ key: "OPENAI_API_KEY", value: apiKey, secret: true },
			],
			command: "cline",
			comment: "# works with any model — switch freely",
		},
	};
}

function snippetToText(snippet: Snippet): string {
	const lines: string[] = [];
	for (const env of snippet.exports) {
		lines.push(`export ${env.key}=${env.value}`);
	}
	lines.push(snippet.command);
	return lines.join("\n");
}

function maskKey(apiKey: string): string {
	return apiKey.length > 16
		? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
		: apiKey;
}

export default function QuickStart({ apiKey }: { apiKey: string }) {
	const [activeTool, setActiveTool] = useState<ToolId>("claude-code");
	const [copied, setCopied] = useState(false);
	const snippets = buildSnippets(apiKey);
	const masked = maskKey(apiKey);
	const snippet = snippets[activeTool];
	const hasExports = snippet.exports.length > 0;

	const handleCopy = async () => {
		await navigator.clipboard.writeText(snippetToText(snippet));
		setCopied(true);
		toast.success("Snippet copied");
		window.setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium">Quick start</h3>
				<button
					type="button"
					onClick={handleCopy}
					className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
				>
					{copied ? (
						<Check className="h-3 w-3" />
					) : (
						<Copy className="h-3 w-3" />
					)}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>

			<div className="-mx-0.5 flex flex-wrap gap-1">
				{TOOLS.map((tool) => {
					const isActive = activeTool === tool.id;
					return (
						<button
							key={tool.id}
							type="button"
							onClick={() => setActiveTool(tool.id)}
							className={cn(
								"inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-all",
								isActive
									? "border-foreground/15 bg-muted text-foreground shadow-sm"
									: "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
							)}
						>
							<tool.icon className="h-3.5 w-3.5" />
							<span className="font-medium">{tool.name}</span>
							{tool.highlight && (
								<span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
									{tool.highlight}
								</span>
							)}
						</button>
					);
				})}
			</div>

			<div className="rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-relaxed overflow-x-auto">
				{snippet.exports.map((env) => (
					<div
						key={env.key}
						className="text-muted-foreground whitespace-nowrap mt-0.5 first:mt-0"
					>
						<span className="text-muted-foreground/60">$</span> export {env.key}
						=
						<span className="text-foreground">
							{env.secret ? masked : env.value}
						</span>
					</div>
				))}
				<div
					className={cn(
						"text-muted-foreground whitespace-nowrap",
						hasExports && "mt-0.5",
					)}
				>
					<span className="text-muted-foreground/60">$</span>{" "}
					<span className="text-foreground">{snippet.command}</span>
				</div>
				<div className="mt-3 text-muted-foreground/60">{snippet.comment}</div>
			</div>
		</div>
	);
}
