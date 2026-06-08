/**
 * SSRF guards for developer-supplied webhook URLs. Pure (no node:dns / node:net)
 * so it stays browser-safe for the shared barrel; the worker layers DNS
 * resolution on top of `isPrivateOrReservedIp` to also defeat DNS rebinding.
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** True for an IPv4/IPv6 literal that must never be a webhook destination. */
export function isPrivateOrReservedIp(ip: string): boolean {
	const host = ip
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "");

	const v4 = host.match(IPV4_RE);
	if (v4) {
		const octets = v4.slice(1, 5).map((o) => Number(o));
		if (octets.some((o) => o < 0 || o > 255)) {
			return true; // malformed → treat as unsafe
		}
		const [a, b] = octets;
		if (a === 10) {
			return true; // 10.0.0.0/8
		}
		if (a === 127) {
			return true; // loopback
		}
		if (a === 0) {
			return true; // "this" network
		}
		if (a === 172 && b >= 16 && b <= 31) {
			return true; // 172.16.0.0/12
		}
		if (a === 192 && b === 168) {
			return true; // 192.168.0.0/16
		}
		if (a === 169 && b === 254) {
			return true; // link-local incl. cloud metadata
		}
		if (a === 100 && b >= 64 && b <= 127) {
			return true; // CGNAT 100.64.0.0/10
		}
		if (a >= 224) {
			return true; // multicast / reserved
		}
		return false;
	}

	// IPv6 (or IPv4-mapped IPv6).
	if (host.includes(":")) {
		if (host === "::1" || host === "::") {
			return true; // loopback / unspecified
		}
		if (/^fe[89ab]/.test(host)) {
			return true; // link-local fe80::/10
		}
		if (host.startsWith("fc") || host.startsWith("fd")) {
			return true; // ULA fc00::/7
		}
		const mapped = host.match(
			/(?:::ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/,
		);
		if (mapped) {
			return isPrivateOrReservedIp(mapped[1]);
		}
		return false;
	}

	return false;
}

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost"];
const BLOCKED_HOSTS = new Set([
	"localhost",
	"metadata.google.internal",
	"metadata",
]);

/**
 * Validate a webhook URL at registration / pre-send time: must be https and must
 * not point at a private/loopback/link-local/metadata IP literal or an obvious
 * internal hostname. Throws `Error` with a descriptive message; returns the
 * parsed URL on success. Does NOT resolve DNS (callers that can should also
 * check the resolved IPs — see the worker delivery path).
 */
export function assertSafeWebhookUrl(rawUrl: string): URL {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error("Invalid webhook URL");
	}

	if (url.protocol !== "https:") {
		throw new Error("Webhook URL must use https");
	}

	const host = url.hostname.toLowerCase();

	if (
		BLOCKED_HOSTS.has(host) ||
		BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))
	) {
		throw new Error("Webhook URL points at a disallowed internal host");
	}

	// IP literal? Validate its range directly.
	const isIpLiteral =
		IPV4_RE.test(host) || host.includes(":") || rawUrl.includes("[");
	if (isIpLiteral && isPrivateOrReservedIp(host)) {
		throw new Error("Webhook URL points at a private or reserved address");
	}

	return url;
}
