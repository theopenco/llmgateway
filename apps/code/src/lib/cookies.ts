// Small client-side cookie helpers for dismissible UI state. Cookies (not
// localStorage) so server components can read the value and SSR the correct
// first paint, per the repo guideline for user settings not saved in the DB.

export function getCookie(name: string): string | null {
	if (typeof document === "undefined") {
		return null;
	}
	const match = document.cookie
		.split("; ")
		.find((row) => row.startsWith(`${name}=`));
	return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function setCookie(name: string, value: string, maxAgeDays: number) {
	if (typeof document === "undefined") {
		return;
	}
	const maxAge = Math.round(maxAgeDays * 24 * 60 * 60);
	document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}
