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
	// Lookarounds instead of \b so topics ending in punctuation ("C++") match.
	return new RegExp(
		`(?<![\\w])${escapeRegex(keyword.toLowerCase())}${INFLECTIONS}(?![\\w])`,
		"i",
	);
}

interface KeywordPattern {
	keyword: string;
	pattern: RegExp;
}

const TOPIC_PATTERNS: Record<string, KeywordPattern[]> = Object.fromEntries(
	Object.entries(TOPIC_KEYWORDS).map(([topic, keywords]) => [
		topic,
		keywords.map((keyword) => ({ keyword, pattern: keywordPattern(keyword) })),
	]),
);

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
		const key = topicKey(topic);
		const label = topicLabel(topic);
		const patterns = Object.hasOwn(TOPIC_PATTERNS, key)
			? TOPIC_PATTERNS[key]!
			: [{ keyword: label, pattern: keywordPattern(label) }];
		const found = patterns.find(({ pattern }) => pattern.test(content));
		if (found) {
			matches.push(`${topic}: ${found.keyword}`);
		}
	}

	return {
		passed: matches.length === 0,
		matches,
		action,
	};
}
