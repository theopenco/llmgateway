import { getConnInfo } from "@hono/node-server/conninfo";

import type { Context } from "hono";

// Returns a client IP suitable for use as an abuse / rate-limit key: a value the
// caller cannot forge in this deployment. This is deliberately stricter than a
// best-effort "who is this" lookup — a spoofable value here lets an attacker
// rotate the apparent IP and mint a fresh rate-limit bucket per request.
//
// Trust model (matches the rest of the API, e.g. apps/api/src/auth/config.ts):
//   1. CF-Connecting-IP — set by Cloudflare at the edge and overwritten on every
//      request, so a client cannot spoof it as long as the origin only accepts
//      Cloudflare traffic. Primary trusted source in production.
//   2. The real TCP peer address (getConnInfo). This is the actual socket
//      source; in a direct-to-origin request (no Cloudflare) it is the caller's
//      real IP and is likewise unspoofable.
//   3. X-Forwarded-For / X-Real-IP — client-settable headers, trusted ONLY when
//      the operator opts in via TRUST_PROXY_HEADERS=true (self-hosters who front
//      the API with a proxy that strips/overwrites these). Never trusted by
//      default: these were the vector used to bypass the provider-listing rate
//      limit by sending a different forged IP on each request.
export function getTrustedClientIp(c: Context): string | null {
	const cfConnectingIp = c.req.header("CF-Connecting-IP")?.trim();
	if (cfConnectingIp) {
		return cfConnectingIp;
	}

	if (process.env.TRUST_PROXY_HEADERS === "true") {
		const forwarded = c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
		if (forwarded) {
			return forwarded;
		}
		const realIp = c.req.header("X-Real-IP")?.trim();
		if (realIp) {
			return realIp;
		}
	}

	try {
		const address = getConnInfo(c).remote.address?.trim();
		if (address) {
			return address;
		}
	} catch {
		// getConnInfo throws when there is no underlying Node socket (e.g. unit
		// tests that call app.request() directly). Fall through to null.
	}

	return null;
}
