import { Resolver } from "node:dns/promises";

import { websiteVerificationRecord } from "./airside-domains.js";

const DNS_TIMEOUT_MS = 5_000;

/**
 * Whether the domain publishes the company's verification token as a TXT
 * record under `name`.
 *
 * Uses a fresh resolver rather than the process-wide one so a hung or
 * blackholed nameserver cannot pin the request open: `Resolver` supports a
 * per-instance timeout, `dns.promises.resolveTxt` does not. A missing record
 * (ENODATA/ENOTFOUND) is an ordinary "not verified yet", not an error.
 */
export async function domainPublishesToken(
	name: string,
	domain: string,
	token: string,
): Promise<boolean> {
	const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
	let records: string[][];
	try {
		records = await resolver.resolveTxt(`${name}.${domain}`);
	} catch {
		return false;
	}
	const expected = websiteVerificationRecord(token);
	// A TXT record arrives as its ~255-char chunks; DNS clients join them with
	// no separator, so a token split across chunks still has to match.
	return records.some((chunks) => chunks.join("").trim() === expected);
}
