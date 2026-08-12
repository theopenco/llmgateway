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
		// The IDE extension identifies as "codex_vscode/<version> (<os>) …", which
		// none of the CLI-shaped patterns match.
		userAgentPatterns: [
			/^codex[-_]cli/i,
			/^codex_cli_rs\//i,
			/^codex[-_]tui\//i,
			/^codex[-_]vscode\//i,
			// Headless `codex exec` runs identify as "codex_exec/<version> …".
			/^codex[-_]exec/i,
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
		id: "empryo",
		label: "Empryo",
		xSourceValues: ["empryo"],
		userAgentPatterns: [/^empryo\//i, /\bempryo\b/i],
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
		// n8n's OpenAI node sends a bare "n8n" with no version suffix.
		userAgentPatterns: [/^n8n$/i, /^n8n\//i, /\bn8n-workflow\b/i],
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
		// Copilot's BYOK/OpenAI-compatible requests send no x-source; they
		// identify only via camel-cased User-Agents ("GitHubCopilotChat/0.26.7",
		// "GithubCopilot/1.155.0", Copilot CLI) that `\bcopilot\b` alone misses
		// because there is no word boundary inside "GitHubCopilotChat".
		userAgentPatterns: [
			/^github-copilot\//i,
			/^githubcopilot/i,
			/copilot[-_]?cli/i,
			/\bcopilot\b/i,
		],
	},
	{
		id: "pi-agent",
		label: "Pi Agent",
		xSourceValues: ["pi-agent", "pi-coding-agent"],
		// The CLI sends a bare "pi-coding-agent" with no version suffix.
		userAgentPatterns: [
			/^pi-agent\//i,
			/\bpi[-_]agent\b/i,
			/\bpi[-_]coding[-_]agent\b/i,
		],
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
		id: "crush",
		label: "Crush",
		xSourceValues: ["crush", "charm-crush"],
		userAgentPatterns: [
			/^charm[-_]crush\//i,
			/^crush\//i,
			/charm\.land\/crush/i,
		],
	},
	{
		id: "kimi-code",
		label: "Kimi Code",
		xSourceValues: ["kimi-code", "kimi-cli"],
		userAgentPatterns: [/^kimi[-_]code/i, /^kimi[-_]cli\//i],
	},
	{
		id: "qwen-code",
		label: "Qwen Code",
		xSourceValues: ["qwen-code", "qwencode"],
		userAgentPatterns: [/^qwencode\//i, /\bqwen[-_]code\b/i],
	},
	{
		id: "factory-droid",
		label: "Factory Droid",
		xSourceValues: ["factory-droid", "factory", "droid"],
		userAgentPatterns: [
			/^factory[-_]cli\//i,
			/^droid\//i,
			/\bfactory[-_]droid\b/i,
		],
	},
	{
		id: "mimo-code",
		label: "MiMo Code",
		xSourceValues: ["mimo-code", "mimocode"],
		// The CLI sends a bare "mimocode" product token with no separator.
		userAgentPatterns: [/^mimo[-_]?code/i, /\bmimo[-_]code\b/i],
	},
	{
		id: "traycer",
		label: "Traycer",
		xSourceValues: ["traycer", "traycer-agents"],
		userAgentPatterns: [/^traycer[-_]agents\b/i, /^traycer\//i, /\btraycer\b/i],
	},
	{
		id: "foundry-toolkit",
		label: "Foundry Toolkit",
		// Microsoft's VS Code extension, formerly "AI Toolkit"/"Windows AI Studio";
		// the marketplace id (and its User-Agent) still says windows-ai-studio.
		xSourceValues: ["foundry-toolkit", "ai-toolkit", "windows-ai-studio"],
		userAgentPatterns: [/^windows[-_]ai[-_]studio/i, /^foundry[-_]toolkit/i],
	},
	{
		id: "openai-sdk",
		label: "OpenAI SDK",
		xSourceValues: ["openai-sdk"],
		// Explicit x-source only. The SDK's own User-Agent ("OpenAI/Python 2.x",
		// "AsyncOpenAI/Python 2.x", "OpenAI/JS 6.x") says nothing about what is
		// driving it, so matching on it would attribute every plain API script as
		// a coding agent — and did so asymmetrically, since the sync Python client
		// matched while the async one and the JS client did not.
		userAgentPatterns: [],
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
