export const PLAYGROUND_KEY_COOKIE_NAME = "llmgateway_playground_key";
export const PLAYGROUND_KEY_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;
export const PLAYGROUND_SCOPED_COOKIE_LIMIT = 10;

export function getPlaygroundKeyCookieName(projectId: string): string {
	return `${PLAYGROUND_KEY_COOKIE_NAME}_${projectId}`;
}

export function getPlaygroundKeyCookieNamesToRemove(
	cookieNames: string[],
	currentProjectId: string,
): string[] {
	const currentName = getPlaygroundKeyCookieName(currentProjectId);
	const scopedPrefixes = [
		`${PLAYGROUND_KEY_COOKIE_NAME}_`,
		`__Host-${PLAYGROUND_KEY_COOKIE_NAME}_`,
	];
	const otherScopedNames = Array.from(new Set(cookieNames)).filter(
		(name) =>
			name !== currentName &&
			scopedPrefixes.some((prefix) => name.startsWith(prefix)),
	);
	const removeCount = Math.max(
		0,
		otherScopedNames.length - (PLAYGROUND_SCOPED_COOKIE_LIMIT - 1),
	);
	return otherScopedNames.slice(0, removeCount);
}
