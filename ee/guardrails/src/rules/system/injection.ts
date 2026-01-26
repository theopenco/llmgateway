import type { SystemRule } from "@/types.js";

const INJECTION_PATTERNS = [
	/ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|text)/i,
	/disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,
	/forget\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,
	/override\s+(your\s+)?(system\s+)?(instructions?|prompts?|rules?)/i,
	/new\s+(system\s+)?instructions?:\s*/i,
	/system\s*:\s*you\s+(are|will)/i,
	/\[system\]/i,
	/<system>/i,
	/###\s*(system|instruction|prompt)/i,
	/you\s+are\s+now\s+(a|an|acting)/i,
	/from\s+now\s+on,?\s+(you|ignore)/i,
	/end\s+(of\s+)?(system\s+)?(prompt|instructions?)/i,
	/\bprompt\s*injection\b/i,
	/ignore\s+(everything|anything)\s+(above|before)/i,
	/this\s+is\s+the\s+(real|actual|new)\s+(prompt|instruction)/i,
];

export const injectionRule: SystemRule = {
	id: "system:prompt_injection",
	name: "Prompt Injection Detection",
	category: "injection",
	defaultEnabled: true,
	defaultAction: "block",
	check: (content, config) => {
		if (!config.enabled) {
			return { passed: true, matches: [] };
		}

		const matches: string[] = [];
		for (const pattern of INJECTION_PATTERNS) {
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
