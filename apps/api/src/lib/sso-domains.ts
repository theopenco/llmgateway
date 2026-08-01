// An SSO connection's `domain` column holds one or more email domains as a
// comma-separated list. Every consumer (the SSO plugin's sign-in resolution and
// SAML-callback trust check, plus our own SSO-only enforcement) splits on
// commas, so multi-domain connections work end-to-end — e.g. an org whose
// userPrincipalName domain differs from its mail domain needs both listed.
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface NormalizedSsoDomains {
	/** Lowercased, trimmed, deduped domains in input order. */
	domains: string[];
	/** Entries that are not valid DNS domains (as typed, trimmed). */
	invalid: string[];
}

export function normalizeSsoDomains(input: string): NormalizedSsoDomains {
	const domains: string[] = [];
	const invalid: string[] = [];
	const seen = new Set<string>();

	for (const entry of input.split(",")) {
		const domain = entry.trim().toLowerCase();
		if (!domain) {
			continue;
		}
		if (!DOMAIN_RE.test(domain)) {
			invalid.push(entry.trim());
			continue;
		}
		if (!seen.has(domain)) {
			seen.add(domain);
			domains.push(domain);
		}
	}

	return { domains, invalid };
}
