/**
 * ISO 3166-1 alpha-2 country code resolved by the edge proxy, if it has one.
 */
export function getCountryFromHeaders(
	headers: Headers | null | undefined,
): string | undefined {
	// Cloudflare sends XX when it cannot resolve the client IP.
	const country = headers?.get("CF-IPCountry");
	return country && country !== "XX" ? country.toUpperCase() : undefined;
}
