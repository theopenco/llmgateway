export interface CodingAgentDefinition {
	id: string;
	label: string;
	xSourceValues: string[];
	userAgentPatterns: RegExp[];
}

export const CODING_AGENTS: CodingAgentDefinition[] = [
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
		userAgentPatterns: [/^codex[-_]cli/i, /^codex_cli_rs\//i, /^codex\//i],
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
		xSourceValues: ["hermes-agent", "hermes"],
		userAgentPatterns: [/^hermes[-_]agent\//i, /\bhermes[-_]agent\b/i],
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
