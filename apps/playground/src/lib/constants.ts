import {
	PLAYGROUND_KEY_COOKIE_MAX_AGE,
	PLAYGROUND_KEY_COOKIE_NAME,
} from "@llmgateway/shared";

export { PLAYGROUND_KEY_COOKIE_MAX_AGE, PLAYGROUND_KEY_COOKIE_NAME };

export const PLAYGROUND_KEY_COOKIE_NAMES = [
	PLAYGROUND_KEY_COOKIE_NAME,
	`__Host-${PLAYGROUND_KEY_COOKIE_NAME}`,
] as const;

interface PlaygroundCookieStore {
	get: (name: string) => { value: string } | undefined;
}

export function getPlaygroundKeyForRequest(
	cookieStore: PlaygroundCookieStore,
): string | undefined {
	return (
		cookieStore.get(PLAYGROUND_KEY_COOKIE_NAME)?.value ??
		cookieStore.get(`__Host-${PLAYGROUND_KEY_COOKIE_NAME}`)?.value
	);
}

// Set when the user explicitly picks the "Chat plan" context in the org
// switcher; cleared when they pick a dashboard org. The playground shell's
// funded-org fallback must not override an explicit choice.
export const CHAT_CONTEXT_COOKIE = "llmgateway_chat_context";
