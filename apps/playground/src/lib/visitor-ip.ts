import { headers } from "next/headers";

/**
 * Headers to attach to a server-side call to the API so the visitor — not this
 * app's own address — is what the API's per-IP rate limits key on. Without it
 * every visitor of a server-rendered page shares one bucket, and a single
 * scraper locks everyone out.
 *
 * `x-forwarded-for` is what the load balancer in front of us sets and what the
 * API reads back (`getClientIpFromContext`), so the visitor's chain is passed
 * through unchanged.
 */
export async function visitorIpHeaders(): Promise<Record<string, string>> {
	const forwardedFor = (await headers()).get("x-forwarded-for");
	return forwardedFor ? { "x-forwarded-for": forwardedFor } : {};
}
