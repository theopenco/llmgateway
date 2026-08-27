import { getDomain } from "tldts";

import { getProviderDefaultBaseUrl } from "@llmgateway/actions";
import { providers } from "@llmgateway/models";

import type { ProviderId } from "@llmgateway/models";

/**
 * Domain matching for Airside provider claims: a user may claim a catalogue
 * provider when the registrable domain of their verified email matches the
 * registrable domain of the provider's API endpoint (or, as a fallback for
 * providers without a static endpoint, its website).
 */

export function registrableDomain(hostname: string): string {
	const normalized = hostname.toLowerCase().replace(/\.$/, "");
	// Full ICANN public-suffix list, so "api.foo.co.nz" collapses to
	// "foo.co.nz" and never to the bare suffix (which any .co.nz email would
	// match). Private PSL entries (github.io, …) stay ordinary domains, like
	// before. Hosts without a known suffix (localhost, IPs) pass through.
	return getDomain(normalized) ?? normalized;
}

function hostOf(url: string): string | undefined {
	try {
		return new URL(url).hostname;
	} catch {
		return undefined;
	}
}

/**
 * Registrable domains that qualify for claiming the given provider.
 * Empty for providers with neither a static endpoint nor a website
 * (e.g. stealth providers) — those cannot be self-claimed.
 */
export function providerClaimDomains(providerId: string): Set<string> {
	const domains = new Set<string>();
	const baseUrl = getProviderDefaultBaseUrl(providerId as ProviderId);
	const baseHost = baseUrl ? hostOf(baseUrl) : undefined;
	if (baseHost) {
		domains.add(registrableDomain(baseHost));
	}
	const definition = providers.find((p) => p.id === providerId);
	const websiteHost = definition?.website
		? hostOf(definition.website)
		: undefined;
	if (websiteHost) {
		domains.add(registrableDomain(websiteHost));
	}
	return domains;
}

export function emailRegistrableDomain(email: string): string | undefined {
	const at = email.lastIndexOf("@");
	if (at === -1 || at === email.length - 1) {
		return undefined;
	}
	return registrableDomain(email.slice(at + 1));
}

// Personal email providers. Nobody hosts a provider API on these domains, so
// an address here can neither claim nor register a carrier — the portal tells
// the user to come back with a company address instead of dead-ending.
const FREEMAIL_DOMAINS = new Set([
	"aol.com",
	"daum.net",
	"fastmail.com",
	"gmail.com",
	"gmx.de",
	"gmx.net",
	"googlemail.com",
	"hey.com",
	"hotmail.com",
	"icloud.com",
	"live.com",
	"mail.com",
	"mail.ru",
	"me.com",
	"msn.com",
	"naver.com",
	"outlook.com",
	"proton.me",
	"protonmail.com",
	"qq.com",
	"t-online.de",
	"web.de",
	"yahoo.com",
	"yandex.com",
	"yandex.ru",
	"ymail.com",
	"zoho.com",
	"126.com",
	"163.com",
]);

export function isFreemailDomain(domain: string | undefined): boolean {
	return domain !== undefined && FREEMAIL_DOMAINS.has(domain.toLowerCase());
}

export interface ClaimableProvider {
	providerId: string;
	name: string;
	matchedDomain: string;
}

/** Catalogue providers whose claim domains match the email's domain. */
export function claimableProvidersForEmail(email: string): ClaimableProvider[] {
	const emailDomain = emailRegistrableDomain(email);
	if (!emailDomain) {
		return [];
	}
	return providers.flatMap((p) =>
		providerClaimDomains(p.id).has(emailDomain)
			? [{ providerId: p.id, name: p.name, matchedDomain: emailDomain }]
			: [],
	);
}
