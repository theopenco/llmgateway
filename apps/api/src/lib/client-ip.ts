import ipaddr from "ipaddr.js";

type HeaderGetter = (name: string) => string | null | undefined;

// Header precedence used across the API for the originating client IP.
// X-Forwarded-For comes first: it is the header the GCP load balancer in front
// of the API sets, and it is what the gateway's IAM CIDR rules already key on
// (its first hop is the client). CF-Connecting-IP follows for deployments
// fronted by Cloudflare, then fallbacks for other proxies and local dev.
const CLIENT_IP_HEADERS = [
	"x-forwarded-for",
	"cf-connecting-ip",
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

/**
 * Whether an address is routable on the public internet. Private, loopback,
 * link-local and reserved ranges (including IPv4-mapped IPv6) return false, so
 * geo and reputation lookups skip addresses no third party can resolve.
 */
export function isPublicIp(ip: string | null | undefined): boolean {
	if (!ip) {
		return false;
	}
	try {
		let parsed = ipaddr.parse(ip);
		if (
			parsed.kind() === "ipv6" &&
			(parsed as ipaddr.IPv6).isIPv4MappedAddress()
		) {
			parsed = (parsed as ipaddr.IPv6).toIPv4Address();
		}
		return parsed.range() === "unicast";
	} catch {
		return false;
	}
}
