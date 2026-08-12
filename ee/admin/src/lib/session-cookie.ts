import { cookies } from "next/headers";

const SESSION_COOKIE = "better-auth.session_token";

/**
 * Builds the `Cookie` header used to forward the caller's better-auth session
 * to the API. Returns an empty string when the visitor has no session cookie.
 */
export async function getSessionCookieHeader() {
	const cookieStore = await cookies();
	const sessionCookie = cookieStore.get(SESSION_COOKIE);
	const secureSessionCookie = cookieStore.get(`__Secure-${SESSION_COOKIE}`);

	if (secureSessionCookie) {
		return `__Secure-${SESSION_COOKIE}=${secureSessionCookie.value}`;
	}

	if (sessionCookie) {
		return `${SESSION_COOKIE}=${sessionCookie.value}`;
	}

	return "";
}

export async function hasSessionCookie() {
	const cookieStore = await cookies();

	return (
		cookieStore.has(SESSION_COOKIE) ||
		cookieStore.has(`__Secure-${SESSION_COOKIE}`)
	);
}
