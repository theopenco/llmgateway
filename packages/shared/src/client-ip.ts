import ipaddr from "ipaddr.js";

type HeaderGetter = (name: string) => string | null | undefined;

interface HeaderContext {
	req: { header: (name: string) => string | undefined };
}

const MISSING_CLIENT_IP_HEADER =
	"CLIENT_IP_HEADER is not set. It must name the header the edge overwrites with the client address — X-Client-Ip on the hosted deployment, or whatever your reverse proxy sets. There is no default: guessing would silently key rate limits and IP allow-lists on a header a caller can forge.";

/**
 * The one header carrying the client IP, named once per deployment by
 * `CLIENT_IP_HEADER`.
 *
 * There is deliberately no list of candidates and no default. Trying several
 * headers in turn means trusting whichever one a caller happened to send, so a
 * single forged header picks the identity — useless for rate limiting and
 * actively wrong for IP allow-lists. Naming the header makes the trust
 * boundary explicit: it is whatever the edge overwrites, and nothing else.
 *
 * Throws when unset. A deployment that has not named the header is
 * misconfigured, and failing at startup is far better than serving traffic
 * that silently buckets every visitor together.
 */
export function getClientIpHeaderName(): string {
	const configured = process.env.CLIENT_IP_HEADER?.trim();
	if (!configured) {
		throw new Error(MISSING_CLIENT_IP_HEADER);
	}
	return configured.toLowerCase();
}

/**
 * Fails startup when the deployment has not named the header. Call this before
 * a service begins serving, so the mistake surfaces at deploy time rather than
 * as wrong rate-limit buckets and denied IP allow-lists under real traffic.
 */
export function assertClientIpHeaderConfigured(): void {
	getClientIpHeaderName();
}

/** First hop of a comma-separated forwarding chain, which is the client. */
export function getClientIpFromForwardedFor(
	xff: string | null | undefined,
): string | undefined {
	return xff?.split(",")[0]?.trim() || undefined;
}

export function getClientIp(getHeader: HeaderGetter): string | null {
	return (
		getClientIpFromForwardedFor(getHeader(getClientIpHeaderName())) ?? null
	);
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
	return getClientIpFromContext(c) ?? undefined;
}

/**
 * Header to attach when calling the API on a visitor's behalf from a
 * server-rendered page or proxy route: the same one the API reads, passed
 * through verbatim. Without it the API sees the calling server's address and
 * every visitor shares one rate-limit bucket.
 */
export function forwardedIpHeaders(
	headers: Headers | null | undefined,
): Record<string, string> {
	const name = getClientIpHeaderName();
	const value = headers?.get(name);
	return value ? { [name]: value } : {};
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
