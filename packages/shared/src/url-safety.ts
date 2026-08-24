/**
 * SSRF guards for developer-supplied webhook URLs. Pure (no node:dns / node:net)
 * so it stays browser-safe for the shared barrel; the worker layers DNS
 * resolution on top of `isPrivateOrReservedIp` to also defeat DNS rebinding.
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Parse an IPv6 literal into its 8 hextets. Returns null on anything malformed
 * so callers can fail closed. Handles `::` compression, an embedded dotted-quad
 * tail (`::ffff:127.0.0.1`), and strips a zone index (`fe80::1%eth0`).
 */
function parseIpv6(host: string): number[] | null {
	let s = host.split("%")[0];

	const v4Tail = s.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
	if (v4Tail) {
		const m = v4Tail[2].match(IPV4_RE);
		if (!m) {
			return null;
		}
		const o = m.slice(1, 5).map((x) => Number(x));
		if (o.some((x) => x > 255)) {
			return null;
		}
		s = `${v4Tail[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
	}

	const halves = s.split("::");
	if (halves.length > 2) {
		return null;
	}
	const head = halves[0] ? halves[0].split(":") : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
	if (halves.length === 1 && head.length !== 8) {
		return null;
	}
	if (halves.length === 2 && head.length + tail.length > 7) {
		return null;
	}
	const groups = [
		...head,
		...(Array(8 - head.length - tail.length).fill("0") as string[]),
		...tail,
	];
	const hextets: number[] = [];
	for (const g of groups) {
		if (!/^[0-9a-f]{1,4}$/.test(g)) {
			return null;
		}
		hextets.push(parseInt(g, 16));
	}
	return hextets;
}

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

	// IPv6. Parse to hextets so non-canonical spellings (0:0:0:0:0:0:0:1) and
	// IPv4-embedding transition addresses (NAT64/6to4/Teredo) can't slip past
	// string matching; malformed literals fail closed.
	if (host.includes(":")) {
		const h = parseIpv6(host);
		if (!h) {
			return true;
		}
		// Last 32 bits as dotted quad, for prefixes that embed an IPv4 target.
		const embeddedV4 = () =>
			isPrivateOrReservedIp(
				`${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`,
			);
		if (h.every((x) => x === 0)) {
			return true; // :: unspecified
		}
		if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) {
			return true; // ::1 loopback
		}
		// IPv4-mapped ::ffff:0:0/96 (dotted or hex form) and the deprecated
		// IPv4-compatible ::/96 — both route to the embedded IPv4.
		if (
			h.slice(0, 5).every((x) => x === 0) &&
			(h[5] === 0xffff || h[5] === 0)
		) {
			return embeddedV4();
		}
		if (
			h[0] === 0x64 &&
			h[1] === 0xff9b &&
			h[2] === 0 &&
			h[3] === 0 &&
			h[4] === 0 &&
			h[5] === 0
		) {
			return embeddedV4(); // NAT64 well-known prefix 64:ff9b::/96
		}
		if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) {
			return true; // NAT64 local-use 64:ff9b:1::/48
		}
		if (h[0] === 0x2002) {
			return true; // 6to4 2002::/16 (embeds IPv4 relay target)
		}
		if (h[0] === 0x2001 && h[1] <= 0x01ff) {
			return true; // 2001::/23 IETF special-purpose (Teredo, benchmarking, ORCHID)
		}
		if (h[0] === 0x2001 && h[1] === 0xdb8) {
			return true; // documentation 2001:db8::/32
		}
		if (h[0] === 0x3fff && (h[1] & 0xf000) === 0) {
			return true; // documentation 3fff::/20
		}
		if (h[0] === 0x100 && h[1] === 0 && h[2] === 0 && h[3] === 0) {
			return true; // discard-only 100::/64
		}
		if ((h[0] & 0xffc0) === 0xfe80) {
			return true; // link-local fe80::/10
		}
		if ((h[0] & 0xfe00) === 0xfc00) {
			return true; // ULA fc00::/7
		}
		if ((h[0] & 0xff00) === 0xff00) {
			return true; // multicast ff00::/8
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

function assertSafeHttpsUrl(rawUrl: string, label: string): URL {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error(`Invalid ${label[0].toLowerCase()}${label.slice(1)}`);
	}

	if (url.protocol !== "https:") {
		throw new Error(`${label} must use https`);
	}

	const host = url.hostname.toLowerCase();

	if (
		BLOCKED_HOSTS.has(host) ||
		BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
	) {
		throw new Error(`${label} points at a disallowed internal host`);
	}

	const isIpLiteral =
		IPV4_RE.test(host) || host.includes(":") || rawUrl.includes("[");
	if (isIpLiteral && isPrivateOrReservedIp(host)) {
		throw new Error(`${label} points at a private or reserved address`);
	}

	return url;
}

/** Validate any user-controlled server-side fetch target before DNS lookup. */
export function assertSafeUserUrl(rawUrl: string): URL {
	return assertSafeHttpsUrl(rawUrl, "User-provided URL");
}

/**
 * Validate a user-supplied content URL (an image/video/document URL embedded in
 * a chat-completion, image, or video request) that the gateway will fetch
 * server-side. Same SSRF rules as provider base URLs: must be https and must not
 * point at a private/loopback/link-local/metadata IP literal or an obvious
 * internal hostname. Throws `Error` with a descriptive message; returns the
 * parsed URL on success. Does NOT resolve DNS — `assertSafeUserContentUrl` in
 * url-safety-node wraps this with a DNS lookup so a hostname resolving to an
 * internal address is also rejected.
 */
export function assertSafeContentUrl(rawUrl: string): URL {
	return assertSafeHttpsUrl(rawUrl, "Content URL");
}
