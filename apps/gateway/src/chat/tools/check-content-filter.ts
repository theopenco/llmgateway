import type { BaseMessage, MessageContent } from "@llmgateway/models";

let cachedKeywords: string[] | null = null;
let cachedEnvValue: string | undefined;

/**
 * Returns the list of blocked keywords from LLM_CONTENT_FILTER_KEYWORDS env var.
 * Keywords are comma-separated and lowercased for case-insensitive matching.
 * Results are cached until the env var value changes.
 */
function getFilterKeywords(): string[] {
	const envValue = process.env.LLM_CONTENT_FILTER_KEYWORDS;

	if (envValue === cachedEnvValue && cachedKeywords !== null) {
		return cachedKeywords;
	}

	cachedEnvValue = envValue;

	if (!envValue || envValue.trim() === "") {
		cachedKeywords = [];
		return cachedKeywords;
	}

	cachedKeywords = envValue
		.split(",")
		.map((k) => k.trim().toLowerCase())
		.filter((k) => k.length > 0);

	return cachedKeywords;
}

function extractTextFromContent(content: string | MessageContent[]): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.map((part) => {
			if ("text" in part && typeof part.text === "string") {
				return part.text;
			}
			return "";
		})
		.join(" ");
}

/**
 * Checks if any message content contains a blocked keyword.
 * Returns the first matched keyword, or null if no match.
 */
export function checkContentFilter(messages: BaseMessage[]): string | null {
	const keywords = getFilterKeywords();

	if (keywords.length === 0) {
		return null;
	}

	for (const message of messages) {
		const text = extractTextFromContent(message.content).toLowerCase();

		for (const keyword of keywords) {
			if (text.includes(keyword)) {
				return keyword;
			}
		}
	}

	return null;
}
