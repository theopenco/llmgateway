import {
	getPlaygroundKeyCookieName,
	getPlaygroundKeyCookieNamesToRemove,
	PLAYGROUND_KEY_COOKIE_MAX_AGE,
	PLAYGROUND_KEY_COOKIE_NAME,
} from "@llmgateway/shared";

export {
	getPlaygroundKeyCookieName,
	getPlaygroundKeyCookieNamesToRemove,
	PLAYGROUND_KEY_COOKIE_MAX_AGE,
	PLAYGROUND_KEY_COOKIE_NAME,
};

export const PLAYGROUND_PROJECT_HEADER = "x-llmgateway-project-id";
export const PLAYGROUND_KEY_COOKIE_NAMES = [
	PLAYGROUND_KEY_COOKIE_NAME,
	`__Host-${PLAYGROUND_KEY_COOKIE_NAME}`,
] as const;

interface PlaygroundCookieStore {
	get: (name: string) => { value: string } | undefined;
}

export function getPlaygroundKeyForRequest(
	cookieStore: PlaygroundCookieStore,
	request: Request,
): string | undefined {
	const projectHeader = request.headers.get(PLAYGROUND_PROJECT_HEADER);
	if (projectHeader !== null) {
		const projectId = projectHeader.trim();
		if (!projectId || !/^[A-Za-z0-9_-]+$/.test(projectId)) {
			return undefined;
		}
		const scopedName = getPlaygroundKeyCookieName(projectId);
		return (
			cookieStore.get(scopedName)?.value ??
			cookieStore.get(`__Host-${scopedName}`)?.value
		);
	}

	return (
		cookieStore.get(PLAYGROUND_KEY_COOKIE_NAME)?.value ??
		cookieStore.get(`__Host-${PLAYGROUND_KEY_COOKIE_NAME}`)?.value
	);
}

export function isPlaygroundKeyCookieName(name: string): boolean {
	return PLAYGROUND_KEY_COOKIE_NAMES.some(
		(baseName) => name === baseName || name.startsWith(`${baseName}_`),
	);
}

// Set when the user explicitly picks the "Chat plan" context in the org
// switcher; cleared when they pick a dashboard org. The playground shell's
// funded-org fallback must not override an explicit choice.
export const CHAT_CONTEXT_COOKIE = "llmgateway_chat_context";
