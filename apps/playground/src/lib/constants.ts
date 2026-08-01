export const PLAYGROUND_KEY_COOKIE_NAME = "llmgateway_playground_key";
export const PLAYGROUND_KEY_COOKIE_NAMES = [
	PLAYGROUND_KEY_COOKIE_NAME,
	`__Host-${PLAYGROUND_KEY_COOKIE_NAME}`,
] as const;

// Set when the user explicitly picks the "Chat plan" context in the org
// switcher; cleared when they pick a dashboard org. The playground shell's
// funded-org fallback must not override an explicit choice.
export const CHAT_CONTEXT_COOKIE = "llmgateway_chat_context";
