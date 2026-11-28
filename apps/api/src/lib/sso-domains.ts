import { HTTPException } from "hono/http-exception";
import { getPublicSuffix } from "tldts";

import { and, db, eq, isNotNull, isNull, ne, or, tables } from "@llmgateway/db";

// An SSO connection's `domain` column holds one or more email domains as a
// comma-separated list. Every consumer (the SSO plugin's sign-in resolution and
// SAML-callback trust check, plus our own SSO-only enforcement) splits on

/** Whether the domain is itself a public suffix (co.uk, github.io, a bare TLD). */
export function isPublicSuffix(domain: string): boolean {
	return getPublicSuffix(domain, { allowPrivateDomains: true }) === domain;
}

// Better Auth's SSO plugin matches a connection's domains by suffix, so a claim
// on acme.com also captures users at eu.acme.com and vice versa.
export function ssoDomainsOverlap(a: string, b: string): boolean {
	return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Rejects with 409 when any domain equals, contains or is contained in a domain
 * claimed by another non-deleted organization's SSO connection or auto-join
 * setting. A domain may belong to only one organization.
 */
export async function assertSsoDomainsUnclaimed(
	domains: string[],
	organizationId: string,
): Promise<void> {
	const liveOrganization = or(
		isNull(tables.organization.status),
		ne(tables.organization.status, "deleted"),
	);
	const providers = await db
		.select({ domain: tables.ssoProvider.domain })
		.from(tables.ssoProvider)
		.leftJoin(
			tables.organization,
			eq(tables.organization.id, tables.ssoProvider.organizationId),
		)
		.where(
			and(
				or(
					isNull(tables.ssoProvider.organizationId),
					ne(tables.ssoProvider.organizationId, organizationId),
				),
				liveOrganization,
			),
		);
	const autoJoinOrgs = await db
		.select({ ssoAutoJoinDomain: tables.organization.ssoAutoJoinDomain })
		.from(tables.organization)
		.where(
			and(
				ne(tables.organization.id, organizationId),
				isNotNull(tables.organization.ssoAutoJoinDomain),
				liveOrganization,
			),
		);
	const claimed = [
		...providers.flatMap((row) => normalizeSsoDomains(row.domain).domains),
		...autoJoinOrgs.flatMap((row) =>
			row.ssoAutoJoinDomain ? [row.ssoAutoJoinDomain.toLowerCase()] : [],
		),
	];
	const taken = domains.filter((domain) =>
		claimed.some((other) => ssoDomainsOverlap(domain, other)),
	);
	if (taken.length > 0) {
		throw new HTTPException(409, {
			message: `Email domain(s) overlap a domain configured by another organization: ${taken.join(", ")}`,
		});
	}
}

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
