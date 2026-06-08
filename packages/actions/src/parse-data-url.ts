export interface ParsedDataUrl {
	/**
	 * The media (MIME) type, e.g. `"image/png"` or `"application/pdf"`. Optional
	 * RFC 2397 parameters (e.g. `;charset=utf-8`) are stripped. Empty string when
	 * the URL omits a media type (e.g. `data:,hello`).
	 */
	mediaType: string;
	/** Whether the payload is base64-encoded (a trailing `;base64` token). */
	isBase64: boolean;
	/**
	 * The raw payload after the comma (base64 or percent-encoded text). Returned
	 * via `slice`, so V8 shares the input's backing store instead of copying.
	 */
	data: string;
}

const DATA_URL_PREFIX = "data:";
const BASE64_SUFFIX = ";base64";

/**
 * Parses a `data:` URL into its media type, base64 flag, and payload.
 *
 * Chat-completion payloads can carry multi-megabyte base64 images and
 * documents. A single `^data:...,(.*)$` regex scans the entire payload and
 * allocates a full copy of it into the capture group — costing several
 * milliseconds per call on a 20MB attachment. This helper instead finds the
 * header/body boundary with `indexOf(",")`, validates only the short header,
 * and returns the body via `slice` (no scan, no copy). Parsing therefore stays
 * effectively constant-time regardless of payload size and avoids exposing a
 * regex engine to attacker-controlled lengths.
 *
 * Returns `null` when `value` is not a data URL (e.g. an `https://` URL) or has
 * no comma separating the header from the payload.
 */
export function parseDataUrl(value: string): ParsedDataUrl | null {
	// Reject non-data URLs before touching the payload. Only the short prefix is
	// lowercased — never the (potentially huge) body.
	if (
		value.length < DATA_URL_PREFIX.length ||
		value.slice(0, DATA_URL_PREFIX.length).toLowerCase() !== DATA_URL_PREFIX
	) {
		return null;
	}

	const comma = value.indexOf(",");
	if (comma === -1) {
		return null;
	}

	// Header is short: "data:<mediaType>[;param=value]*[;base64]".
	let header = value.slice(DATA_URL_PREFIX.length, comma);

	let isBase64 = false;
	if (
		header.length >= BASE64_SUFFIX.length &&
		header.slice(-BASE64_SUFFIX.length).toLowerCase() === BASE64_SUFFIX
	) {
		isBase64 = true;
		header = header.slice(0, -BASE64_SUFFIX.length);
	}

	// The media type is everything up to the first parameter separator.
	const semicolon = header.indexOf(";");
	const mediaType = semicolon === -1 ? header : header.slice(0, semicolon);

	return {
		mediaType,
		isBase64,
		data: value.slice(comma + 1),
	};
}
