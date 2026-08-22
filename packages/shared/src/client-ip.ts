import ipaddr from "ipaddr.js";

type HeaderGetter = (name: string) => string | null | undefined;

interface HeaderContext {
	req: { header: (name: string) => string | undefined };
}

/**
 * Header precedence for the originating client IP, most trusted first.
 *
 * X-Forwarded-For comes first because it is what the GCP load balancer in
 * front of every deployed service sets, and it is what the gateway's IAM CIDR
 * rules already key on (its first hop is the client). The rest are fallbacks
 * for other proxies and local dev.
 *
 * We do NOT use Cloudflare, so `cf-connecting-ip` is never present in
 * production — it is kept only as a fallback for self-hosted deployments that
 * do sit behind it.
 */
const CLIENT_IP_HEADERS = [
	"x-forwarded-for",
	"cf-connecting-ip",
	"x-real-ip",
	"x-client-ip",
	"remote-addr",
] as const;

/** First hop of an X-Forwarded-For chain, which is the originating client. */
export function getClientIpFromForwardedFor(
	xff: string | null | undefined,
): string | undefined {
	return xff?.split(",")[0]?.trim() || undefined;
}

export function getClientIp(getHeader: HeaderGetter): string | null {
	for (const header of CLIENT_IP_HEADERS) {
		const value = getClientIpFromForwardedFor(getHeader(header));
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

export function getClientIpFromContext(c: HeaderContext): string | null {
	return getClientIp((name) => c.req.header(name));
}

/** Hono-flavoured alias used by the gateway routes. */
export function getClientIpFromRequest(c: HeaderContext): string | undefined {
	return getClientIpFromForwardedFor(c.req.header("x-forwarded-for"));
}

/**
 * Headers to attach when calling the API on a visitor's behalf from a
 * server-rendered page or proxy route. Without them the API sees the calling
 * server's address and every visitor shares one rate-limit bucket.
 */
export function forwardedIpHeaders(
	headers: Headers | null | undefined,
): Record<string, string> {
	const forwardedFor = headers?.get("x-forwarded-for");
	return forwardedFor ? { "x-forwarded-for": forwardedFor } : {};
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
		return normalize(ipaddr.parse(ip)).range() === "unicast";
	} catch {
		return false;
	}
}

// Normalize IPv4-mapped IPv6 (::ffff:1.2.3.4) to plain IPv4 so an IPv4 CIDR
// matches a request that arrived with an IPv4-mapped IPv6 source.
function normalize(addr: ipaddr.IPv4 | ipaddr.IPv6): ipaddr.IPv4 | ipaddr.IPv6 {
	if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
		return (addr as ipaddr.IPv6).toIPv4Address();
	}
	return addr;
}

export function ipMatchesCidr(clientIp: string, cidr: string): boolean {
	try {
		const client = normalize(ipaddr.parse(clientIp));
		const [rangeAddr, prefixStr] = cidr.split("/");
		if (!rangeAddr || prefixStr === undefined) {
			return false;
		}
		const range = normalize(ipaddr.parse(rangeAddr));
		const prefix = Number(prefixStr);
		if (!Number.isFinite(prefix) || prefix < 0) {
			return false;
		}
		if (client.kind() !== range.kind()) {
			return false;
		}
		const maxPrefix = client.kind() === "ipv4" ? 32 : 128;
		if (prefix > maxPrefix) {
			return false;
		}
		// ipaddr.js match() expects [addr, prefixLength]
		return (client as ipaddr.IPv4 | ipaddr.IPv6).match([
			range as never,
			prefix,
		] as never);
	} catch {
		return false;
	}
}

export function anyCidrMatches(clientIp: string, cidrs: string[]): boolean {
	return cidrs.some((cidr) => ipMatchesCidr(clientIp, cidr));
}
