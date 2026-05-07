/**
 * Detects which coding agent (Claude Code, Cursor, Cline, etc.) made a request
 * by inspecting the User-Agent header. Used as a fallback when neither
 * x-source nor HTTP-Referer identify the caller.
 *
 * Returning `undefined` leaves the source unset rather than guessing — better
 * to under-attribute than mis-attribute traffic in usage dashboards.
 */
export function detectCodingAgentFromUserAgent(
	userAgent: string | undefined,
): string | undefined {
	if (!userAgent) {
		return undefined;
	}

	const ua = userAgent.trim();

	// Claude Code (Anthropic's official CLI)
	if (/^claude-cli\//i.test(ua) || /\bclaude-code\b/i.test(ua)) {
		return "claude.com/claude-code";
	}

	// OpenAI Codex CLI (Rust + Node distributions)
	if (
		/^codex[-_]cli/i.test(ua) ||
		/^codex_cli_rs\//i.test(ua) ||
		/^codex\//i.test(ua)
	) {
		return "codex";
	}

	// OpenCode (https://opencode.ai)
	if (/^opencode\//i.test(ua) || /\bopencode-cli\b/i.test(ua)) {
		return "opencode";
	}

	// Cline (VS Code extension) — \bcline\b also matches "Cline-VSCode/…"
	if (/\bcline\b/i.test(ua)) {
		return "cline";
	}

	// Cursor desktop / extension
	if (/^Cursor\//i.test(ua) || /\bcursor-llm\b/i.test(ua)) {
		return "cursor";
	}

	// Autohand Code
	if (/^autohand\//i.test(ua) || /\bautohand-code\b/i.test(ua)) {
		return "autohand";
	}

	// SoulForge
	if (/^soulforge\//i.test(ua)) {
		return "soulforge";
	}

	// n8n workflow runner
	if (/^n8n\//i.test(ua) || /\bn8n-workflow\b/i.test(ua)) {
		return "n8n";
	}

	// OpenClaw
	if (/^openclaw\//i.test(ua)) {
		return "openclaw";
	}

	return undefined;
}
