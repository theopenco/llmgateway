import { headers } from "next/headers";

/**
 * Headers to attach to a server-side call to the API so the visitor — not this
 * app's own address — is what the API's per-IP rate limits key on. Without it
 * every visitor of a server-rendered page shares one bucket, and a single
 * scraper locks everyone out.
 *
 * Only `cf-connecting-ip` is forwarded: Cloudflare overwrites any
 * client-supplied value, so it is the one IP header a visitor cannot poison.
 * Never forward `x-forwarded-for` or `x-real-ip`.
 */
export async function visitorIpHeaders(): Promise<Record<string, string>> {
	const visitorIp = (await headers()).get("cf-connecting-ip");
	return visitorIp ? { "cf-connecting-ip": visitorIp } : {};
}
