import ipaddr from "ipaddr.js";

type HeaderGetter = (name: string) => string | null | undefined;

interface HeaderContext {
	req: { header: (name: string) => string | undefined };
}

/**
 * Header the client IP is read from when nothing is configured. Correct behind
 * a reverse proxy that overwrites it, which is the usual self-hosted shape —
 * and why a plain build or local run needs no configuration at all.
 *
 * Not correct on the hosted deployment: the load balancer there *appends* to
 * the chain rather than replacing it, so the first hop is caller-supplied and
 * forgeable. That is why hosting requires the variable instead of falling back
 * to this.
 */
const DEFAULT_CLIENT_IP_HEADER = "x-forwarded-for";

/**
 * The one header carrying the client IP, named by `CLIENT_IP_HEADER`.
 *
 * There is deliberately no list of candidates. Trying several headers in turn
 * means trusting whichever one a caller happened to send, so a single forged
 * header picks the identity — useless for rate limiting and actively wrong for
 * IP allow-lists. Naming the header makes the trust boundary explicit: it is
 * whatever the edge overwrites, and nothing else.
 *
 * The hosted deployment sets it to `X-Client-Ip`, which the load balancer
 * writes from `{client_ip_address}` with `set` (not `add`), so a caller cannot
 * forge it.
 */
export function getClientIpHeaderName(): string {
	return (
		process.env.CLIENT_IP_HEADER?.trim().toLowerCase() ||
		DEFAULT_CLIENT_IP_HEADER
	);
}

/**
 * Refuses to start a hosted deployment that has not named the header. Call
 * this before a service begins serving: on the hosted setup the default is
 * forgeable, and the failure is invisible — every visitor silently shares one
 * rate-limit bucket and the gateway denies keys carrying an IP allow-list —
 * so it has to surface at deploy time instead.
 *
 * Self-hosted and local runs fall back to the default and are left alone;
 * building or running the stack should not require this variable.
 */
export function assertClientIpHeaderConfigured(): void {
	if (process.env.HOSTED !== "true") {
		return;
	}
	if (!process.env.CLIENT_IP_HEADER?.trim()) {
		throw new Error(
			"CLIENT_IP_HEADER is not set. A hosted deployment must name the header the load balancer overwrites with the client address (X-Client-Ip). Without it the client IP would be read from a header a caller can forge, silently keying every rate limit and IP allow-list on it.",
		);
	}
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
