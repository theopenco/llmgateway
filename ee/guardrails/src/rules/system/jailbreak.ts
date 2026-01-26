import type { SystemRule } from "@/types.js";

const JAILBREAK_PATTERNS = [
	/DAN\s*(mode|prompt)?/i,
	/do\s+anything\s+now/i,
	/developer\s+mode/i,
	/evil\s+(mode|assistant|bot)/i,
	/pretend\s+(you\s+)?(are|have)\s+no\s+(restrictions?|limits?|rules?)/i,
	/act\s+as\s+if\s+(you\s+)?have\s+no\s+(ethics?|morals?)/i,
	/bypass\s+(your\s+)?(safety|content)\s+(filters?|restrictions?)/i,
	/unlock\s+(your\s+)?(full|hidden)\s+(potential|capabilities)/i,
	/jailbreak(ed|ing)?/i,
	/roleplay\s+as\s+(an?\s+)?(evil|malicious|unethical)/i,
	/disable\s+(your\s+)?(safety|content)\s+(features?|filters?)/i,
	/ignore\s+(your\s+)?(ethical|safety)\s+(guidelines?|training)/i,
	/you\s+have\s+no\s+(content\s+)?policy/i,
	/you\s+can\s+say\s+anything/i,
];

export const jailbreakRule: SystemRule = {
	id: "system:jailbreak",
	name: "Jailbreak Prevention",
	category: "jailbreak",
	defaultEnabled: true,
	defaultAction: "block",
	check: (content, config) => {
		if (!config.enabled) {
			return { passed: true, matches: [] };
		}

		const matches: string[] = [];
		for (const pattern of JAILBREAK_PATTERNS) {
			const match = content.match(pattern);
			if (match) {
				matches.push(match[0]);
			}
		}

		return {
			passed: matches.length === 0,
			matches,
		};
	},
};
