/**
 * Response Healing Module
 *
 * Automatically validates and repairs malformed JSON responses from AI models.
 * This feature ensures that API responses conform to specified schemas even when
 * the model's formatting is imperfect.
 *
 * Common issues resolved:
 * - Structural errors: Missing brackets, closing braces, or quotation marks
 * - Markdown wrapping: Extracts JSON from code blocks (```json...```)
 * - Mixed content: Separates JSON from surrounding text or explanatory content
 * - Syntax violations: Removes trailing commas and fixes unquoted object keys
 * - Format inconsistencies: Converts JavaScript-style syntax to valid JSON
 */

import { logger } from "@llmgateway/logger";

export interface HealingResult {
	healed: boolean;
	content: string;
	originalContent: string;
	healingMethod?: string;
}

/**
 * Attempts to extract valid JSON from a string that may contain markdown code blocks
 */
function extractFromMarkdown(content: string): string | null {
	// Try to extract from ```json ... ``` blocks
	const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
	if (jsonBlockMatch && jsonBlockMatch[1]) {
		return jsonBlockMatch[1].trim();
	}

	// Try to extract from ``` ... ``` blocks (no language specified)
	const genericBlockMatch = content.match(/```\s*([\s\S]*?)\s*```/);
	if (genericBlockMatch && genericBlockMatch[1]) {
		const extracted = genericBlockMatch[1].trim();
		// Only return if it looks like JSON
		if (extracted.startsWith("{") || extracted.startsWith("[")) {
			return extracted;
		}
	}

	return null;
}

/**
 * Attempts to extract JSON from mixed content (text before/after JSON)
 * Uses proper bracket matching that respects string boundaries
 */
function extractJsonFromMixedContent(content: string): string | null {
	// Find potential JSON start positions (all { and [)
	// Limit to first 50 positions to avoid O(n²) worst case on large inputs
	const startPositions: number[] = [];
	const MAX_START_POSITIONS = 50;

	for (
		let i = 0;
		i < content.length && startPositions.length < MAX_START_POSITIONS;
		i++
	) {
		if (content[i] === "{" || content[i] === "[") {
			startPositions.push(i);
		}
	}

	if (startPositions.length === 0) {
		return null;
	}

	// Try each potential start position
	for (const start of startPositions) {
		const extracted = extractBalancedJson(content, start);
		if (extracted) {
			try {
				JSON.parse(extracted);
				return extracted;
			} catch {
				// Try next start position
				continue;
			}
		}
	}

	return null;
}

/**
 * Extracts a balanced JSON structure starting from the given position
 * Respects string boundaries when counting brackets
 */
function extractBalancedJson(content: string, start: number): string | null {
	const startChar = content[start];
	if (startChar !== "{" && startChar !== "[") {
		return null;
	}

	// Use a stack to track nested structures properly
	const stack: string[] = [];
	let inString = false;
	let escapeNext = false;

	for (let i = start; i < content.length; i++) {
		const char = content[i];

		if (escapeNext) {
			escapeNext = false;
			continue;
		}

		if (char === "\\") {
			escapeNext = true;
			continue;
		}

		if (char === '"') {
			inString = !inString;
			continue;
		}

		if (inString) {
			continue;
		}

		if (char === "{") {
			stack.push("}");
		} else if (char === "[") {
			stack.push("]");
		} else if (char === "}" || char === "]") {
			if (stack.length === 0 || stack[stack.length - 1] !== char) {
				// Mismatched bracket - this is not valid JSON from this start position
				return null;
			}
			stack.pop();
			if (stack.length === 0) {
				return content.substring(start, i + 1);
			}
		}
	}

	return null;
}

/**
 * Fixes common JSON syntax issues:
 * - Trailing commas
 * - Unquoted keys (JavaScript-style)
 * - Single quotes instead of double quotes
 */
function fixJsonSyntax(content: string): string {
	let fixed = content;

	// Remove trailing commas before } or ]
	fixed = fixed.replace(/,(\s*[}\]])/g, "$1");

	// Fix unquoted keys (e.g., {name: "value"} -> {"name": "value"})
	// Match word characters followed by : but not inside quotes
	fixed = fixed.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

	// Replace single quotes with double quotes for string values
	// This is more complex as we need to avoid replacing apostrophes within strings
	// Simple approach: only replace single quotes that look like string delimiters
	fixed = fixed.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');

	return fixed;
}

/**
 * Attempts to complete truncated JSON by adding missing closing brackets
 */
function completeTruncatedJson(content: string): string | null {
	let completed = content.trim();

	// Count opening and closing brackets
	const openBraces = (completed.match(/{/g) ?? []).length;
	const closeBraces = (completed.match(/}/g) ?? []).length;
	const openBrackets = (completed.match(/\[/g) ?? []).length;
	const closeBrackets = (completed.match(/]/g) ?? []).length;

	// If already balanced, return as-is
	if (openBraces === closeBraces && openBrackets === closeBrackets) {
		return completed;
	}

	// Add missing closing brackets/braces
	// We need to track the order of opening brackets to close them correctly
	const stack: string[] = [];
	let inString = false;
	let escapeNext = false;

	for (const char of completed) {
		if (escapeNext) {
			escapeNext = false;
			continue;
		}

		if (char === "\\") {
			escapeNext = true;
			continue;
		}

		if (char === '"') {
			inString = !inString;
			continue;
		}

		if (inString) {
			continue;
		}

		if (char === "{") {
			stack.push("}");
		} else if (char === "[") {
			stack.push("]");
		} else if (char === "}" || char === "]") {
			if (stack.length > 0 && stack[stack.length - 1] === char) {
				stack.pop();
			}
		}
	}

	// If we're in an unclosed string, close it
	if (inString) {
		completed += '"';
	}

	// Close any remaining brackets in reverse order
	while (stack.length > 0) {
		completed += stack.pop();
	}

	return completed;
}

/**
 * Main healing function that attempts multiple strategies to repair JSON
 */
export function healJsonResponse(content: string): HealingResult {
	const originalContent = content;

	// First, try to parse as-is (no healing needed)
	try {
		JSON.parse(content);
		return {
			healed: false,
			content,
			originalContent,
		};
	} catch {
		// Continue with healing attempts
	}

	// Track current working content through healing pipeline
	let workingContent = content;

	// Strategy 1: Extract from markdown code blocks
	const markdownExtracted = extractFromMarkdown(workingContent);
	if (markdownExtracted) {
		try {
			JSON.parse(markdownExtracted);
			return {
				healed: true,
				content: markdownExtracted,
				originalContent,
				healingMethod: "markdown_extraction",
			};
		} catch {
			// Continue with other strategies on the extracted content
			workingContent = markdownExtracted;
		}
	}

	// Strategy 2: Extract JSON from mixed content
	const mixedExtracted = extractJsonFromMixedContent(workingContent);
	if (mixedExtracted && mixedExtracted !== workingContent) {
		try {
			JSON.parse(mixedExtracted);
			return {
				healed: true,
				content: mixedExtracted,
				originalContent,
				healingMethod: "mixed_content_extraction",
			};
		} catch {
			// Continue with the extracted content
			workingContent = mixedExtracted;
		}
	}

	// Strategy 3: Fix common syntax issues
	const syntaxFixed = fixJsonSyntax(workingContent);
	if (syntaxFixed !== workingContent) {
		try {
			JSON.parse(syntaxFixed);
			return {
				healed: true,
				content: syntaxFixed,
				originalContent,
				healingMethod: "syntax_fix",
			};
		} catch {
			// Continue with the fixed content
			workingContent = syntaxFixed;
		}
	}

	// Strategy 4: Complete truncated JSON (add missing brackets)
	const completed = completeTruncatedJson(workingContent);
	if (completed) {
		try {
			JSON.parse(completed);
			return {
				healed: true,
				content: completed,
				originalContent,
				healingMethod: "truncation_completion",
			};
		} catch {
			// Last resort failed
		}
	}

	// Strategy 5: Combine all strategies
	// Start fresh from original, extract, fix syntax, then complete
	let combined = originalContent;

	const reExtracted = extractFromMarkdown(combined) ?? combined;
	combined =
		extractJsonFromMixedContent(reExtracted) ?? reExtracted ?? combined;
	combined = fixJsonSyntax(combined);
	combined = completeTruncatedJson(combined) ?? combined;

	try {
		JSON.parse(combined);
		return {
			healed: true,
			content: combined,
			originalContent,
			healingMethod: "combined_strategies",
		};
	} catch {
		// All strategies failed
		logger.warn("Response healing failed - all strategies exhausted", {
			originalContent:
				originalContent.length > 500
					? originalContent.substring(0, 500) + "..."
					: originalContent,
		});
	}

	// Return original content if healing failed
	return {
		healed: false,
		content: originalContent,
		originalContent,
	};
}

/**
 * Validates JSON against a JSON Schema
 * Returns true if valid, false otherwise
 */
export function validateJsonSchema(
	content: string,
	schema: Record<string, unknown>,
): boolean {
	try {
		const parsed = JSON.parse(content);

		// Basic schema validation (type and required properties)
		if (
			schema.type === "object" &&
			(typeof parsed !== "object" || Array.isArray(parsed) || parsed === null)
		) {
			return false;
		}
		if (schema.type === "array" && !Array.isArray(parsed)) {
			return false;
		}

		// Check required properties
		const required = schema.required as string[] | undefined;
		if (required && Array.isArray(required)) {
			for (const prop of required) {
				if (!(prop in parsed)) {
					return false;
				}
			}
		}

		// Check properties types
		const properties = schema.properties as Record<string, any> | undefined;
		if (properties && typeof parsed === "object" && !Array.isArray(parsed)) {
			for (const [key, propSchema] of Object.entries(properties)) {
				if (key in parsed) {
					const value = parsed[key];
					const propType = propSchema.type;

					if (propType === "string" && typeof value !== "string") {
						return false;
					}
					if (propType === "number" && typeof value !== "number") {
						return false;
					}
					if (propType === "boolean" && typeof value !== "boolean") {
						return false;
					}
					if (propType === "array" && !Array.isArray(value)) {
						return false;
					}
					if (
						propType === "object" &&
						(typeof value !== "object" || Array.isArray(value))
					) {
						return false;
					}
				}
			}
		}

		return true;
	} catch {
		return false;
	}
}

/**
 * Attempts to heal JSON and validate against schema
 * Used when response_format with json_schema is specified
 */
export function healAndValidateJson(
	content: string,
	schema?: Record<string, unknown>,
): HealingResult & { valid: boolean } {
	const healingResult = healJsonResponse(content);

	// If no schema provided, just check if it's valid JSON
	if (!schema) {
		try {
			JSON.parse(healingResult.content);
			return { ...healingResult, valid: true };
		} catch {
			return { ...healingResult, valid: false };
		}
	}

	const valid = validateJsonSchema(healingResult.content, schema);
	return { ...healingResult, valid };
}
