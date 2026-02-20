import { HTTPException } from "hono/http-exception";

/**
 * Validates and normalizes the x-source header with HTTP-Referer fallback
 * Strips http(s):// and www. if present
 * Validates allowed characters: a-zA-Z0-9, -, ., /
 */
export function validateSource(
	source: string | undefined,
	referer?: string | undefined,
): string | undefined {
	// Use x-source if available, otherwise fallback to HTTP-Referer
	const sourceToValidate = source ?? referer;

	if (!sourceToValidate) {
		return undefined;
	}

	// Strip http:// or https:// if present
	let normalized = sourceToValidate.replace(/^https?:\/\//, "");

	// Strip www. if present
	normalized = normalized.replace(/^www\./, "");

	// Validate allowed characters: a-zA-Z0-9, -, ., /
	const allowedPattern = /^[a-zA-Z0-9./-]+$/;
	if (!allowedPattern.test(normalized)) {
		throw new HTTPException(400, {
			message:
				"Invalid x-source header: only alphanumeric characters, hyphens, dots, and slashes are allowed",
		});
	}

	return normalized;
}
