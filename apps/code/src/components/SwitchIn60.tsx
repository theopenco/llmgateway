"use client";

import { ArrowRight, Check, Clock, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CodeCTATracker } from "@/components/LandingTracker";
import { Button } from "@/components/ui/button";

import {
	AnthropicIcon,
	EmpryoIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";

import type { ComponentType, SVGProps } from "react";

const API_BASE = "https://api.llmgateway.io";

interface Step {
	label: string;
	code?: string;
}

interface ToolGuide {
	id: string;
	label: string;
	icon: ComponentType<SVGProps<SVGSVGElement>>;
	blurb: string;
	steps: Step[];
}

const OpenAiGlyph: ComponentType<SVGProps<SVGSVGElement>> = (props) => (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
		<rect x="3" y="3" width="18" height="18" rx="4" strokeWidth="1.5" />
		<path d="M8 12h8M12 8v8" strokeWidth="1.5" strokeLinecap="round" />
	</svg>
);

const TOOLS: ToolGuide[] = [
	{
		id: "claude-code",
		label: "Claude Code",
		icon: AnthropicIcon,
		blurb: "Two env vars. No SDK changes, no reinstall.",
		steps: [
			{
				label: "Point Claude Code at DevPass",
				code: `export ANTHROPIC_BASE_URL=${API_BASE}\nexport ANTHROPIC_AUTH_TOKEN=<your-devpass-key>`,
			},
			{
				label: "Run it — switch models with one ANTHROPIC_MODEL flip",
				code: "claude",
			},
		],
	},
	{
		id: "opencode",
		label: "OpenCode",
		icon: OpenCodeIcon,
		blurb: "Built in. No env vars, no config files.",
		steps: [
			{ label: "Launch OpenCode", code: "opencode" },
			{ label: "Type /connect, pick LLM Gateway, paste your DevPass key" },
		],
	},
	{
		id: "empryo",
		label: "Empryo",
		icon: EmpryoIcon,
		blurb: "Edits symbols, not strings. One key, every model.",
		steps: [
			{ label: "Launch Empryo", code: "empryo" },
			{ label: "Type /keys and paste your DevPass key" },
		],
	},
	{
		id: "soulforge",
		label: "SoulForge",
		icon: SoulForgeIcon,
		blurb: "Paste one key and the whole catalog is live.",
		steps: [
			{ label: "Launch SoulForge", code: "soulforge" },
			{ label: "Type /keys and paste your DevPass key" },
		],
	},
	{
		id: "openai",
		label: "Anything else",
		icon: OpenAiGlyph,
		blurb: "Cursor, Cline, Aider, Continue — any OpenAI-compatible tool.",
		steps: [
			{
				label: "Set the base URL and key in your tool's settings",
				code: `Base URL: ${API_BASE}/v1\nAPI key:  <your-devpass-key>`,
			},
			{ label: "Pick any model id — Claude, GPT, Gemini, GLM, Qwen…" },
		],
	},
];

function CopyBlock({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		if (!navigator.clipboard?.writeText) {
			return;
		}
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			setCopied(false);
		}
	};

	return (
		<div className="group relative overflow-hidden rounded-lg border border-border/60 bg-background">
			<pre className="overflow-x-auto px-3.5 py-3 font-mono text-xs leading-6 text-foreground/90">
				{code}
			</pre>
			<button
				type="button"
				onClick={handleCopy}
				aria-label="Copy command"
				className="absolute right-2 top-2 rounded-md border border-border/60 bg-card p-1.5 text-muted-foreground transition-colors hover:text-foreground"
			>
				{copied ? (
					<Check className="h-3.5 w-3.5 text-emerald-500" />
				) : (
					<Copy className="h-3.5 w-3.5" />
				)}
			</button>
		</div>
	);
}

export function SwitchIn60() {
	const [active, setActive] = useState(TOOLS[0].id);
	const tool = TOOLS.find((t) => t.id === active) ?? TOOLS[0];

	return (
		<section id="switch-in-60" className="border-t bg-muted/20 px-4 py-16">
			<div className="container mx-auto max-w-3xl">
				<div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
					<Clock className="h-3.5 w-3.5" />
					Switch in 60 seconds
				</div>
				<h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
					Keep your editor. Point it at DevPass.
				</h2>
				<p className="mt-2 max-w-2xl text-muted-foreground">
					No migration project, no rewrite. Your existing tool, every model, one
					key. Switching back is just as fast — so there&apos;s nothing to lose.
				</p>

				<div className="mt-7 flex flex-wrap gap-2">
					{TOOLS.map((t) => {
						const Icon = t.icon;
						const isActive = t.id === active;
						return (
							<button
								key={t.id}
								type="button"
								onClick={() => setActive(t.id)}
								className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
									isActive
										? "border-foreground/30 bg-card text-foreground shadow-sm"
										: "border-border/60 text-muted-foreground hover:text-foreground"
								}`}
							>
								<Icon className="h-4 w-4" />
								{t.label}
							</button>
						);
					})}
				</div>

				<div className="mt-5 rounded-2xl border bg-card p-5 sm:p-6">
					<p className="mb-5 text-sm text-muted-foreground">{tool.blurb}</p>
					<ol className="space-y-4">
						{tool.steps.map((step, index) => (
							<li key={step.label} className="flex gap-3.5">
								<span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-border/60 bg-background text-xs font-semibold tabular-nums text-muted-foreground">
									{index + 1}
								</span>
								<div className="min-w-0 flex-1 space-y-2">
									<p className="text-sm font-medium text-foreground">
										{step.label}
									</p>
									{step.code && <CopyBlock code={step.code} />}
								</div>
							</li>
						))}
					</ol>

					<div className="mt-6 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center">
						<CodeCTATracker cta="get_started" location="compare_switch_in_60">
							<Button className="gap-2" asChild>
								<Link href="/signup?plan=pro">
									Get your DevPass key
									<ArrowRight className="h-4 w-4" />
								</Link>
							</Button>
						</CodeCTATracker>
						<p className="text-xs text-muted-foreground">
							Need the full walkthrough? See the{" "}
							<Link href="/guides" className="underline hover:text-foreground">
								setup guides
							</Link>
							.
						</p>
					</div>
				</div>
			</div>
		</section>
	);
}
