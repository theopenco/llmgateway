import type { BaseMessage, MessageContent } from "@llmgateway/models";

export type ContentFilterMode = "disabled" | "monitor" | "enabled";
export type ContentFilterMethod = "keywords" | "openai";

/**
 * Returns the content filter mode from LLM_CONTENT_FILTER_MODE env var.
 * - "disabled" (default): content filter is off
 * - "monitor": check content filter but don't block; log evaluation entries
 * - "enabled": block requests that match content filter keywords
 *
 * Legacy compatibility:
 * - "openai": treated as enabled mode with openai method
 */
export function getContentFilterMode(): ContentFilterMode {
	const envValue = process.env.LLM_CONTENT_FILTER_MODE;

	if (envValue === "monitor") {
		return "monitor";
	}

	if (envValue === "enabled" || envValue === "openai") {
		return "enabled";
	}

	return "disabled";
}

/**
 * Returns the content filter method from LLM_CONTENT_FILTER_METHOD env var.
 * - "keywords" (default): use the configured keyword list
 * - "openai": use OpenAI's moderation endpoint
 *
 * Legacy compatibility:
 * - LLM_CONTENT_FILTER_MODE=openai implies method=openai
 */
export function getContentFilterMethod(): ContentFilterMethod {
	const envValue = process.env.LLM_CONTENT_FILTER_METHOD;
	const legacyModeEnvValue = process.env.LLM_CONTENT_FILTER_MODE;

	if (envValue === "openai" || legacyModeEnvValue === "openai") {
		return "openai";
	}

	return "keywords";
}

/**
 * Returns the list of canonical model names that should have content filtering
 * applied from LLM_CONTENT_FILTER_MODELS.
 *
 * If unset or empty, filtering applies to all models.
 */
export function getContentFilterModels(): string[] | null {
	const envValue = process.env.LLM_CONTENT_FILTER_MODELS;

	if (!envValue || envValue.trim() === "") {
		return null;
	}

	const models = envValue
		.split(",")
		.map((model) => model.trim().toLowerCase())
		.filter((model) => model.length > 0);

	if (models.length === 0) {
		return null;
	}

	return models;
}

export function shouldApplyContentFilterToModel(
	requestedModel: string,
): boolean {
	const filterModels = getContentFilterModels();

	if (filterModels === null) {
		return true;
	}

	return filterModels.includes(requestedModel.trim().toLowerCase());
}

/**
 * Returns the list of blocked keywords from LLM_CONTENT_FILTER_KEYWORDS env var.
 * Keywords are comma-separated and lowercased for case-insensitive matching.
 */
function getFilterKeywords(): string[] {
	const envValue = process.env.LLM_CONTENT_FILTER_KEYWORDS;

	if (!envValue || envValue.trim() === "") {
		return [];
	}

	return envValue
		.split(",")
		.map((k) => k.trim().toLowerCase())
		.filter((k) => k.length > 0);
}

function extractTextFromContent(
	content: string | MessageContent[] | null | undefined,
): string {
	if (typeof content === "string") {
		return content;
	}

	if (!Array.isArray(content)) {
		return "";
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
