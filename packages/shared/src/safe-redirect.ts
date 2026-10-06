const ORIGIN = "https://redirect.invalid";

/**
 * Same-origin path for a post-login redirect. Resolving against a fixed origin
 * catches every form a browser treats as another host (`//evil.com`,
 * `/\evil.com`, encoded or whitespace variants), not just a leading `//`.
 */
export function getSafeRedirectPath(
	url: string | null | undefined,
	fallback = "/",
): string {
	if (!url?.startsWith("/")) {
		return fallback;
	}
	try {
		const target = new URL(url, ORIGIN);
		return target.origin === ORIGIN
			? `${target.pathname}${target.search}${target.hash}`
			: fallback;
	} catch {
		return fallback;
	}
}
