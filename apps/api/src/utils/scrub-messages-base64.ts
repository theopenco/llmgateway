const BASE64_INPUT_PLACEHOLDER = "[base64_image_input_redacted]";
const NESTED_CONTENT_PLACEHOLDER = "[nested_content_truncated]";
const MAX_MESSAGES_DEPTH = 64;

function scrubMessagesBase64AtDepth(messages: unknown, depth: number): unknown {
	if (messages === null || messages === undefined) {
		return messages;
	}
	if (typeof messages === "string") {
		if (
			messages.length > 1000 &&
			(messages.includes(";base64,") || /[A-Za-z0-9+/=]{800,}/.test(messages))
		) {
			return BASE64_INPUT_PLACEHOLDER;
		}
		return messages;
	}
	if (depth >= MAX_MESSAGES_DEPTH) {
		return NESTED_CONTENT_PLACEHOLDER;
	}
	if (Array.isArray(messages)) {
		return messages.map((item) => scrubMessagesBase64AtDepth(item, depth + 1));
	}
	if (typeof messages === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(messages)) {
			out[key] = scrubMessagesBase64AtDepth(value, depth + 1);
		}
		return out;
	}
	return messages;
}

export function scrubMessagesBase64(messages: unknown): unknown {
	return scrubMessagesBase64AtDepth(messages, 0);
}
