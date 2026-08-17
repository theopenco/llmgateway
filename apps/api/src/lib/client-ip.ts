type HeaderGetter = (name: string) => string | null | undefined;

// Header precedence used across the API for the originating client IP:
// CF-Connecting-IP is set by Cloudflare and cannot be spoofed behind it,
// X-Forwarded-For is set by the GCP load balancer (first hop is the client),
// the rest are fallbacks for other proxies and local development.
const CLIENT_IP_HEADERS = [
	"cf-connecting-ip",
	"x-forwarded-for",
	"x-real-ip",
	"x-client-ip",
	"remote-addr",
] as const;

export function getClientIp(getHeader: HeaderGetter): string | null {
	for (const header of CLIENT_IP_HEADERS) {
		// X-Forwarded-For can be a comma-separated chain; take the first entry
		const value = getHeader(header)?.split(",")[0]?.trim();
		if (value) {
			return value;
		}
	}
	return null;
}

export function getClientIpFromHeaders(
	headers: Headers | null | undefined,
): string | null {
	return getClientIp((name) => headers?.get(name));
}

export function getClientIpFromContext(c: {
	req: { header: (name: string) => string | undefined };
}): string | null {
	return getClientIp((name) => c.req.header(name));
}
