import type {
	TopicRestrictionRuleConfig,
	GuardrailAction,
} from "@llmgateway/db";

export interface TopicResult {
	passed: boolean;
	matches: string[];
	action: GuardrailAction;
}

// Simple keyword-based topic detection
// For production, this could be extended with ML classifiers
const TOPIC_KEYWORDS: Record<string, string[]> = {
	politics: [
		"election",
		"vote",
		"democrat",
		"republican",
		"liberal",
		"conservative",
		"politician",
		"congress",
		"senate",
		"government policy",
	],
	religion: [
		"god",
		"jesus",
		"allah",
		"buddha",
		"church",
		"mosque",
		"temple",
		"prayer",
		"worship",
		"spiritual",
	],
	violence: [
		"kill",
		"murder",
		"attack",
		"bomb",
		"weapon",
		"shoot",
		"stab",
		"assault",
		"violent",
	],
	adult_content: [
		"explicit",
		"nsfw",
		"adult content",
		"sexual",
		"pornographic",
	],
	illegal_activities: [
		"hack",
		"crack",
		"pirate",
		"illegal download",
		"drug dealing",
		"money laundering",
	],
	gambling: ["bet", "gamble", "casino", "poker", "lottery", "wager", "betting"],
	medical_advice: [
		"diagnosis",
		"prescribe",
		"medication",
		"treatment",
		"medical advice",
		"health condition",
	],
	financial_advice: [
		"invest",
		"stock",
		"trading",
		"financial advice",
		"portfolio",
		"cryptocurrency investment",
	],
};

export function checkTopicRestriction(
	content: string,
	config: TopicRestrictionRuleConfig,
	action: GuardrailAction,
): TopicResult {
	const matches: string[] = [];
	const contentLower = content.toLowerCase();

	for (const topic of config.blockedTopics) {
		const keywords = TOPIC_KEYWORDS[topic.toLowerCase()];
		if (keywords) {
			for (const keyword of keywords) {
				if (contentLower.includes(keyword.toLowerCase())) {
					matches.push(`${topic}: ${keyword}`);
					break; // One match per topic is enough
				}
			}
		} else {
			// Treat the topic itself as a keyword to search for
			if (contentLower.includes(topic.toLowerCase())) {
				matches.push(topic);
			}
		}
	}

	return {
		passed: matches.length === 0,
		matches,
		action,
	};
}
