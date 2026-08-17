// Headers an edge proxy can attach the client country to, most trusted first.
// X-Client-Region is the GCP Application Load Balancer custom header carrying
// `{client_region}`; X-Client-Geo-Location is Google's combined
// `{client_region},{client_city}` form; CF-IPCountry covers deployments
// fronted by Cloudflare.
const COUNTRY_HEADERS = [
	"x-client-region",
	"x-client-geo-location",
	"cf-ipcountry",
] as const;

/**
 * ISO 3166-1 alpha-2 country code resolved by the edge proxy, if it has one.
 */
export function getCountryFromHeaders(
	headers: Headers | null | undefined,
): string | undefined {
	for (const header of COUNTRY_HEADERS) {
		// The combined GCP header carries `<region>,<city>`; both proxies expand
		// an unknown location to an empty string or Cloudflare's XX.
		const country = headers?.get(header)?.split(",")[0]?.trim().toUpperCase();
		if (country && country !== "XX" && /^[A-Z]{2}$/.test(country)) {
			return country;
		}
	}
	return undefined;
}
