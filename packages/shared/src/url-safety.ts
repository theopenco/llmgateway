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
		const [a, b, c] = octets;
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
		// Other IANA special-use ranges that should never be a provider target.
		if (a === 192 && b === 0 && c === 0) {
			return true; // 192.0.0.0/24 IETF protocol assignments
		}
		if (a === 192 && b === 0 && c === 2) {
			return true; // 192.0.2.0/24 TEST-NET-1
		}
		if (a === 192 && b === 88 && c === 99) {
			return true; // 192.88.99.0/24 6to4 relay anycast
		}
		if (a === 198 && (b === 18 || b === 19)) {
			return true; // 198.18.0.0/15 benchmarking
		}
		if (a === 198 && b === 51 && c === 100) {
			return true; // 198.51.100.0/24 TEST-NET-2
		}
		if (a === 203 && b === 0 && c === 113) {
			return true; // 203.0.113.0/24 TEST-NET-3
		}
		if (a >= 224) {
			return true; // multicast / reserved / 240.0.0.0-4 future use
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
		// IPv4-mapped IPv6 in dotted form, e.g. ::ffff:127.0.0.1
		const mapped = host.match(
			/(?:::ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/,
		);
		if (mapped) {
			return isPrivateOrReservedIp(mapped[1]);
		}
		// IPv4-mapped IPv6 in hex form, e.g. ::ffff:7f00:1 (127.0.0.1) or
		// ::ffff:a9fe:a9fe (169.254.169.254) — dns.lookup can surface this shape.
		const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
		if (mappedHex) {
			const high = parseInt(mappedHex[1], 16);
			const low = parseInt(mappedHex[2], 16);
			const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
			return isPrivateOrReservedIp(ipv4);
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

/**
 * Whether tenant-supplied provider base URLs must be SSRF-validated (https-only,
 * no private/reserved/internal destinations). Enforced by default — including on
 * the hosted multi-tenant deployment. Self-hosted operators who intentionally
 * point providers at an internal or http-only model server (e.g. a local Ollama)
 * can opt out by setting `ALLOW_INSECURE_PROVIDER_URLS=true`.
 */
export function isProviderUrlGuardEnabled(): boolean {
	return process.env.ALLOW_INSECURE_PROVIDER_URLS !== "true";
}

/**
 * Validate a tenant-supplied provider `baseUrl` (custom provider or BYOK base
 * URL override) at registration time. Must be https and must not point at a
 * private/loopback/link-local/metadata IP literal or an obvious internal
 * hostname. Throws `Error` with a descriptive message; returns the parsed URL on
 * success. Does NOT resolve DNS — `assertSafeProviderUrl` in `url-safety-node`
 * wraps this with a DNS lookup so a hostname resolving to an internal address is
 * also rejected at registration.
 */
export function assertSafeProviderBaseUrl(rawUrl: string): URL {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error("Invalid provider base URL");
	}

	if (url.protocol !== "https:") {
		throw new Error("Provider base URL must use https");
	}

	const host = url.hostname.toLowerCase();

	if (
		BLOCKED_HOSTS.has(host) ||
		BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))
	) {
		throw new Error("Provider base URL points at a disallowed internal host");
	}

	const isIpLiteral =
		IPV4_RE.test(host) || host.includes(":") || rawUrl.includes("[");
	if (isIpLiteral && isPrivateOrReservedIp(host)) {
		throw new Error(
			"Provider base URL points at a private or reserved address",
		);
	}

	return url;
}
