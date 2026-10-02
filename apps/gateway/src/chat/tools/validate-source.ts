import { HTTPException } from "hono/http-exception";

/**
 * Strips http(s):// and www., then checks allowed characters:
 * a-zA-Z0-9, -, ., /
 * Returns the normalized value, or undefined if invalid.
 */
function normalizeSource(value: string): string | undefined {
	const normalized = value.replace(/^https?:\/\//, "").replace(/^www\./, "");

	return /^[a-zA-Z0-9./-]+$/.test(normalized) ? normalized : undefined;
}

/**
 * Validates and normalizes the x-source header with HTTP-Referer fallback.
 * An invalid explicit x-source throws 400 (the caller deliberately set it);
 * an invalid implicit referer is dropped so later fallbacks can apply.
 */
export function validateSource(
	source: string | undefined,
	referer?: string | undefined,
): string | undefined {
	// An empty x-source carries no attribution intent; treat it as absent
	// (like on main, which never 400ed on it) so fallbacks still apply.
	if (source) {
		const normalized = normalizeSource(source);
		if (normalized === undefined) {
			throw new HTTPException(400, {
				message:
					"Invalid x-source header: only alphanumeric characters, hyphens, dots, and slashes are allowed",
			});
		}
		return normalized;
	}

	if (referer) {
		// Telemetry-only fallback: drop invalid values instead of failing the request
		return normalizeSource(referer);
	}

	return undefined;
}
