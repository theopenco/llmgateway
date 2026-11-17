import { escapeRegex } from "@/rules/safe-regex.js";

import type {
	TopicRestrictionRuleConfig,
	GuardrailAction,
} from "@llmgateway/db";

export interface TopicResult {
	passed: boolean;
	matches: string[];
	action: GuardrailAction;
}

/**
 * Keyword fallback for the preset topics. Matched as whole words (plus common
 * inflections), so "skill" is not violence and "better" is not gambling. The
 * classifier mode is the accurate option; keywords are a cheap approximation.
 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
	politics: [
		"election",
		"vote",
		"democrat",
		"republican",
		"politician",
		"congress",
		"senate",
		"parliament",
		"government policy",
	],
	religion: [
		"god",
		"jesus",
		"allah",
		"buddha",
		"church",
		"mosque",
		"synagogue",
		"prayer",
		"worship",
	],
	violence: [
		"kill",
		"murder",
		"bomb",
		"weapon",
		"shoot",
		"stab",
		"assault",
		"violent",
	],
	adult_content: ["nsfw", "adult content", "pornographic", "porn", "erotic"],
	illegal_activities: [
		"illegal download",
		"drug dealing",
		"money laundering",
		"counterfeit",
		"hack into",
	],
	gambling: [
		"gamble",
		"gambling",
		"casino",
		"poker",
		"lottery",
		"wager",
		"betting",
	],
	medical_advice: [
		"diagnosis",
		"diagnose",
		"prescribe",
		"prescription",
		"medication",
		"medical advice",
		"health condition",
	],
	financial_advice: [
		"financial advice",
		"investment advice",
		"stock tip",
		"stocks to buy",
		"portfolio",
		"cryptocurrency investment",
	],
};

export const presetTopics = Object.keys(TOPIC_KEYWORDS);

const INFLECTIONS = "(?:s|es|ed|d|ing|er|ers)?";

function keywordPattern(keyword: string): RegExp {
	return new RegExp(
		`\\b${escapeRegex(keyword.toLowerCase())}${INFLECTIONS}\\b`,
		"i",
	);
}

function topicKey(topic: string): string {
	return topic.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Human-readable topic for classifier questions. */
export function topicLabel(topic: string): string {
	return topic.trim().replace(/_/g, " ");
}

export function checkTopicRestriction(
	content: string,
	config: TopicRestrictionRuleConfig,
	action: GuardrailAction,
): TopicResult {
	const matches: string[] = [];

	for (const topic of config.blockedTopics) {
		if (!topic.trim()) {
			continue;
		}
		// Unknown topics are matched as a phrase.
		const keywords = TOPIC_KEYWORDS[topicKey(topic)] ?? [topicLabel(topic)];
		const keyword = keywords.find((candidate) =>
			keywordPattern(candidate).test(content),
		);
		if (keyword) {
			matches.push(`${topic}: ${keyword}`);
		}
	}

	return {
		passed: matches.length === 0,
		matches,
		action,
	};
}
