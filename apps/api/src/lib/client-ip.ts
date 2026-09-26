import { AsyncLocalStorage } from "node:async_hooks";

import ipaddr from "ipaddr.js";

type HeaderGetter = (name: string) => string | null | undefined;

const requestClientIp = new AsyncLocalStorage<{ ip: string | null }>();

function normalizeIp(value: string | undefined | null): string | null {
	if (!value || !ipaddr.isValid(value)) {
		return null;
	}
	return ipaddr.process(value).toString();
}

export function getClientIp(
	getHeader: HeaderGetter,
	peerIp?: string,
): string | null {
	const peer = normalizeIp(peerIp);
	if (!peer) {
		return requestClientIp.getStore()?.ip ?? null;
	}
	const address = ipaddr.process(peer);
	const trusted = (process.env.TRUSTED_PROXY_CIDRS ?? "")
		.split(",")
		.filter((cidr) => cidr.trim())
		.some((cidr) => {
			const range = ipaddr.parseCIDR(cidr.trim());
			return range[0].kind() === address.kind() && address.match(range);
		});
	if (!trusted) {
		return peer;
	}
	const header =
		process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || "x-forwarded-for";
	const value = getHeader(header)?.trim();
	if (header !== "x-forwarded-for") {
		return normalizeIp(value) ?? peer;
	}
	const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
	if (!Number.isSafeInteger(hops) || hops < 1) {
		throw new Error("TRUSTED_PROXY_HOPS must be a positive integer");
	}
	return normalizeIp(value?.split(",").at(-hops)?.trim()) ?? peer;
}

export function runWithClientIp<T>(
	headers: Headers,
	peerIp: string | undefined,
	callback: () => T,
): T {
	return requestClientIp.run(
		{ ip: getClientIp((name) => headers.get(name), peerIp) },
		callback,
	);
}

export function getClientIpFromHeaders(
	headers: Headers | null | undefined,
	peerIp?: string,
): string | null {
	return getClientIp((name) => headers?.get(name), peerIp);
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
