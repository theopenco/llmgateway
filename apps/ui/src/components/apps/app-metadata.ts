import {
	AnthropicIcon,
	AutohandIcon,
	ClineIcon,
	CodexIcon,
	CursorIcon,
	KimiIcon,
	MimoCodeIcon,
	N8nIcon,
	OpenClawIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";

import type React from "react";

export interface AppMetadata {
	displayName: string;
	url?: string;
	description: string;
	category: "coding" | "automation" | "other";
	Icon?: React.FC<React.SVGProps<SVGSVGElement>>;
}

export const APP_METADATA: Record<string, AppMetadata> = {
	"claude.com/claude-code": {
		displayName: "Claude Code",
		url: "https://claude.com/claude-code",
		description:
			"Anthropic's official CLI. Routes through LLM Gateway with two env vars to use any model, not just Claude.",
		category: "coding",
		Icon: AnthropicIcon,
	},
	cursor: {
		displayName: "Cursor",
		url: "https://cursor.com",
		description:
			"AI code editor. Custom OpenAI base URL points Cursor at LLM Gateway for unified billing.",
		category: "coding",
		Icon: CursorIcon,
	},
	cline: {
		displayName: "Cline",
		url: "https://cline.bot",
		description:
			"Autonomous coding agent in VS Code. Plug in your DevPass key and let it ship.",
		category: "coding",
		Icon: ClineIcon,
	},
	codex: {
		displayName: "Codex CLI",
		url: "https://github.com/openai/codex",
		description:
			"OpenAI's open-source coding agent for the terminal. Works with any LLM Gateway model.",
		category: "coding",
		Icon: CodexIcon,
	},
	opencode: {
		displayName: "OpenCode",
		url: "https://opencode.ai",
		description:
			"Native LLM Gateway integration. Run `opencode`, `/connect`, paste your DevPass key.",
		category: "coding",
		Icon: OpenCodeIcon,
	},
	aider: {
		displayName: "Aider",
		url: "https://aider.chat",
		description:
			"AI pair programming in your terminal. Edits files in your local git repo.",
		category: "coding",
	},
	"continue.dev": {
		displayName: "Continue",
		url: "https://continue.dev",
		description:
			"Open-source AI assistant for VS Code and JetBrains. Models swap with one config line.",
		category: "coding",
	},
	windsurf: {
		displayName: "Windsurf",
		url: "https://codeium.com/windsurf",
		description:
			"Codeium's agentic editor. Uses LLM Gateway as a drop-in OpenAI-compatible endpoint.",
		category: "coding",
	},
	"roo-cline": {
		displayName: "Roo Code",
		url: "https://roocode.com",
		description:
			"Cline fork with extended autonomy. Same DevPass key, same flat price.",
		category: "coding",
	},
	"kilo-code": {
		displayName: "Kilo Code",
		url: "https://kilocode.ai",
		description:
			"Open-source AI coding agent for VS Code. Works with any provider via LLM Gateway.",
		category: "coding",
	},
	"kimi-code": {
		displayName: "Kimi Code",
		url: "https://github.com/MoonshotAI/kimi-code",
		description:
			"Open-source AI coding agent CLI by Moonshot AI. Point it at LLM Gateway to code with any model.",
		category: "coding",
		Icon: KimiIcon,
	},
	"mimo-code": {
		displayName: "MiMo Code",
		url: "https://mimo.xiaomi.com/mimocode",
		description:
			"AI-powered coding agent CLI by Xiaomi. Point it at LLM Gateway to code with any model.",
		category: "coding",
		Icon: MimoCodeIcon,
	},
	zed: {
		displayName: "Zed",
		url: "https://zed.dev",
		description:
			"High-performance editor with Assistant. Configure a custom OpenAI endpoint and you're in.",
		category: "coding",
	},
	"bolt.new": {
		displayName: "Bolt.new",
		url: "https://bolt.new",
		description:
			"StackBlitz's in-browser AI app builder. Generates and runs full-stack apps.",
		category: "coding",
	},
	"v0.dev": {
		displayName: "v0",
		url: "https://v0.dev",
		description:
			"Vercel's AI UI generator. Produces production-ready React components from prompts.",
		category: "coding",
	},
	"lovable.dev": {
		displayName: "Lovable",
		url: "https://lovable.dev",
		description:
			"Browser-based full-stack AI builder. Ships apps from a chat thread.",
		category: "coding",
	},
	autohand: {
		displayName: "Autohand",
		url: "https://autohand.ai",
		description:
			"Browser-based coding agent. Hands you a working app from a single prompt.",
		category: "coding",
		Icon: AutohandIcon,
	},
	soulforge: {
		displayName: "SoulForge",
		url: "https://soulforge.proxysoul.com/",
		description:
			"Graph-powered coding agent. Treats code as structure, not strings.",
		category: "coding",
		Icon: SoulForgeIcon,
	},
	openclaw: {
		displayName: "OpenClaw",
		url: "https://openclaw.ai",
		description:
			"Open-source agent framework with first-class LLM Gateway support.",
		category: "coding",
		Icon: OpenClawIcon,
	},
	n8n: {
		displayName: "n8n",
		url: "https://n8n.io",
		description:
			"Workflow automation platform. Drop an LLM Gateway node into any workflow.",
		category: "automation",
		Icon: N8nIcon,
	},
};

export function getAppMetadata(source: string): AppMetadata {
	const known = APP_METADATA[source];
	if (known) {
		return known;
	}
	return {
		displayName: source,
		description: "Custom integration sending traffic through LLM Gateway.",
		category: "other",
	};
}
