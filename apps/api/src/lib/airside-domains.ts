import { getProviderDefaultBaseUrl } from "@llmgateway/actions";
import { providers } from "@llmgateway/models";

import type { ProviderId } from "@llmgateway/models";

/**
 * Domain matching for Airside provider claims: a user may claim a catalogue
 * provider when the registrable domain of their verified email matches the
 * registrable domain of the provider's API endpoint (or, as a fallback for
 * providers without a static endpoint, its website).
 */

// Minimal set of two-label public suffixes seen in provider/company domains.
// Not a full PSL — enough for "api.foo.co.uk" -> "foo.co.uk" style hosts.
const SECOND_LEVEL_TLDS = new Set([
	"co.uk",
	"co.jp",
	"co.kr",
	"co.in",
	"co.id",
	"co.za",
	"com.au",
	"com.br",
	"com.cn",
	"com.hk",
	"com.mx",
	"com.sg",
	"com.tr",
	"com.tw",
]);

export function registrableDomain(hostname: string): string {
	const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
	if (labels.length <= 2) {
		return labels.join(".");
	}
	const lastTwo = labels.slice(-2).join(".");
	if (SECOND_LEVEL_TLDS.has(lastTwo)) {
		return labels.slice(-3).join(".");
	}
	return lastTwo;
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
