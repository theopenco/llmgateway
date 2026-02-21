import type { SystemRule } from "@/types.js";

const SECRET_PATTERNS = [
	// AWS keys
	/\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/,
	// AWS Secret Key
	/\b[A-Za-z0-9/+=]{40}\b/,
	// Generic API keys
	/\b(api[_-]?key|apikey)[=:]\s*['"]?[A-Za-z0-9_-]{20,}['"]?\b/i,
	// Bearer tokens
	/\bBearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
	// JWT tokens
	/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/,
	// GitHub tokens
	/\b(gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/,
	// Slack tokens
	/\bxox[baprs]-[0-9]{10,}-[0-9]{10,}-[a-zA-Z0-9]{24,}\b/,
	// Stripe keys
	/\b(sk|pk)_(test|live)_[A-Za-z0-9]{24,}\b/,
	// OpenAI keys
	/\bsk-[A-Za-z0-9]{48,}\b/,
	// Private keys
	/-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
	// Connection strings
	/\b(postgres|mysql|mongodb|redis):\/\/[^\s]+:[^\s]+@[^\s]+\b/i,
	// Password patterns
	/\b(password|passwd|pwd)[=:]\s*['"]?[^\s'"]{8,}['"]?\b/i,
];

export const secretsRule: SystemRule = {
	id: "system:secrets",
	name: "Secrets Detection",
	category: "secrets",
	defaultEnabled: true,
	defaultAction: "block",
	check: (content, config) => {
		if (!config.enabled) {
			return { passed: true, matches: [] };
		}

		const matches: string[] = [];
		for (const pattern of SECRET_PATTERNS) {
			const match = content.match(pattern);
			if (match) {
				// Truncate the match to avoid exposing the full secret
				const truncated =
					match[0].length > 20
						? match[0].substring(0, 10) + "..." + match[0].slice(-5)
						: match[0];
				matches.push(truncated);
			}
		}

		return {
			passed: matches.length === 0,
			matches,
		};
	},
};
