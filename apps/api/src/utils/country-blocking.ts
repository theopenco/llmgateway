export function getBlockedSignupCountries(): string[] {
	return (process.env.BLOCKED_SIGNUP_COUNTRIES ?? "")
		.split(",")
		.map((code) => code.trim().toUpperCase())
		.filter(Boolean);
}

/**
 * Matches an ISO 3166-1 alpha-2 country code (e.g. Cloudflare's CF-IPCountry
 * header) against BLOCKED_SIGNUP_COUNTRIES. A missing or unknown country never
 * blocks, so deployments without a geo header are unaffected.
 */
export function isSignupCountryBlocked(
	country: string | null | undefined,
): boolean {
	if (!country) {
		return false;
	}
	return getBlockedSignupCountries().includes(country.trim().toUpperCase());
}
