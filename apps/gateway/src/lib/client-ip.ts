import ipaddr from "ipaddr.js";

import type { Context } from "hono";

// Extract the originating client IP from request headers. Mirrors the
// ordering used elsewhere in the codebase (Cloudflare first, then the first
// hop of X-Forwarded-For as set by the GCP load balancer, then X-Real-IP).
export function getClientIpFromRequest(c: Context): string | undefined {
	const xff = c.req.header("x-forwarded-for");
	if (xff) {
		const first = xff.split(",")[0]?.trim();
		if (first) {
			return first;
		}
	}
	return undefined;
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
	for (const cidr of cidrs) {
		if (ipMatchesCidr(clientIp, cidr)) {
			return true;
		}
	}
	return false;
}
