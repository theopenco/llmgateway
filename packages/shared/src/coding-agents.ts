export interface CodingAgentDefinition {
	id: string;
	label: string;
	xSourceValues: string[];
	userAgentPatterns: RegExp[];
	titleValues?: string[];
	refererPatterns?: RegExp[];
}

export const CODING_AGENTS: CodingAgentDefinition[] = [
	{
		id: "devpass-code",
		label: "DevPass Code",
		xSourceValues: ["devpass-code"],
		userAgentPatterns: [/^devpass-code\//i, /\bdevpass-code\b/i],
	},
	{
		id: "claude.com/claude-code",
		label: "Claude Code",
		xSourceValues: ["claude.com/claude-code"],
		userAgentPatterns: [/^claude-cli\//i, /\bclaude-code\b/i],
	},
	{
		id: "codex",
		label: "Codex CLI",
		xSourceValues: ["codex"],
		userAgentPatterns: [
			/^codex[-_]cli/i,
			/^codex_cli_rs\//i,
			/^codex[-_]tui\//i,
			/^codex\//i,
		],
	},
	{
		id: "opencode",
		label: "OpenCode",
		xSourceValues: ["opencode", "open-code"],
		userAgentPatterns: [/^opencode\//i, /\bopencode-cli\b/i],
	},
	{
		id: "roo-code",
		label: "Roo Code",
		xSourceValues: ["roo-code", "roo-cline"],
		userAgentPatterns: [/\broo[-_]?code\b/i, /\broo[-_]?cline\b/i],
	},
	{
		id: "cline",
		label: "Cline",
		xSourceValues: ["cline"],
		userAgentPatterns: [/\bcline\b/i],
	},
	{
		id: "kilo-code",
		label: "Kilo Code",
		xSourceValues: ["kilo-code", "kilo"],
		userAgentPatterns: [/\bkilo[-_]?code\b/i, /^kilo\//i],
	},
	{
		id: "cursor",
		label: "Cursor",
		xSourceValues: ["cursor"],
		userAgentPatterns: [/^Cursor\//i, /\bcursor-llm\b/i],
	},
	{
		id: "autohand",
		label: "Autohand Code",
		xSourceValues: ["autohand"],
		userAgentPatterns: [/^autohand\//i, /\bautohand-code\b/i],
	},
	{
		id: "soulforge",
		label: "SoulForge",
		xSourceValues: ["soulforge"],
		userAgentPatterns: [/^soulforge\//i],
	},
	{
		id: "n8n",
		label: "n8n",
		xSourceValues: ["n8n"],
		userAgentPatterns: [/^n8n\//i, /\bn8n-workflow\b/i],
	},
	{
		id: "openclaw",
		label: "OpenClaw",
		xSourceValues: ["openclaw"],
		userAgentPatterns: [/^openclaw\//i],
	},
	{
		id: "aider",
		label: "Aider",
		xSourceValues: ["aider"],
		userAgentPatterns: [/^aider\//i, /\baider\b/i],
	},
	{
		id: "continue",
		label: "Continue",
		xSourceValues: ["continue"],
		userAgentPatterns: [/^continue\//i, /\bcontinue-dev\b/i],
	},
	{
		id: "windsurf",
		label: "Windsurf",
		xSourceValues: ["windsurf", "codeium"],
		userAgentPatterns: [/^windsurf\//i, /\bwindsurf\b/i, /^codeium\//i],
	},
	{
		id: "zed",
		label: "Zed AI",
		xSourceValues: ["zed"],
		userAgentPatterns: [/^Zed\//i, /\bzed-editor\b/i],
	},
	{
		id: "github-copilot",
		label: "GitHub Copilot",
		xSourceValues: ["github-copilot", "copilot"],
		userAgentPatterns: [/^github-copilot\//i, /\bcopilot\b/i],
	},
	{
		id: "pi-agent",
		label: "Pi Agent",
		xSourceValues: ["pi-agent"],
		userAgentPatterns: [/^pi-agent\//i, /\bpi[-_]agent\b/i],
	},
	{
		id: "hermes-agent",
		label: "Hermes Agent",
		xSourceValues: ["hermes-agent", "hermes", "hermes-agent.nousresearch.com"],
		userAgentPatterns: [
			/^hermes[-_]agent\//i,
			/\bhermes[-_]agent\b/i,
			/^HermesAgent\//i,
		],
		titleValues: ["hermes agent"],
		refererPatterns: [/hermes-agent\.nousresearch\.com/i],
	},
	{
		id: "openai-sdk",
		label: "OpenAI SDK",
		xSourceValues: ["openai-sdk"],
		userAgentPatterns: [/^OpenAI\/Python/i, /^Is\/JS/i],
	},
];

/**
 * Any source/UA containing "claw" is allowed (covers openclaw, anyclaw, *-claw forks).
 */
export const CLAW_FORK_PATTERN = /claw/i;

const allowedXSourceSet: Set<string> = new Set(
	CODING_AGENTS.flatMap((a) => a.xSourceValues),
);

export function isRecognizedCodingAgent(source: string | undefined): boolean {
	if (!source) {
		return false;
	}
	if (allowedXSourceSet.has(source)) {
		return true;
	}
	return CLAW_FORK_PATTERN.test(source);
}

export function detectCodingAgentFromTitle(
	title: string | undefined,
): string | undefined {
	if (!title) {
		return undefined;
	}
	const normalized = title.toLowerCase().trim();
	for (const agent of CODING_AGENTS) {
		if (agent.titleValues?.some((t) => normalized === t)) {
			return agent.id;
		}
	}
	return undefined;
}

export function detectCodingAgentFromReferer(
	referer: string | undefined,
): string | undefined {
	if (!referer) {
		return undefined;
	}
	for (const agent of CODING_AGENTS) {
		if (agent.refererPatterns?.some((p) => p.test(referer))) {
			return agent.id;
		}
	}
	return undefined;
}

export function normalizeSourceToAgentId(source: string): string {
	for (const agent of CODING_AGENTS) {
		if (agent.xSourceValues.includes(source)) {
			return agent.id;
		}
	}
	return source;
}

export function getSupportedAgentsList(): string {
	return CODING_AGENTS.map((a) => a.label).join(", ") + ", and any *claw fork";
}
