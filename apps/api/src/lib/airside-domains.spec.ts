import { getPublicSuffix } from "tldts";
import { describe, expect, it } from "vitest";

import { providers } from "@llmgateway/models";

import {
	claimableProvidersForEmail,
	emailRegistrableDomain,
	providerClaimDomains,
	registrableDomain,
} from "./airside-domains.js";

describe("registrableDomain", () => {
	it("collapses subdomains to the registrable domain", () => {
		expect(registrableDomain("api.mistral.ai")).toBe("mistral.ai");
		expect(registrableDomain("generativelanguage.googleapis.com")).toBe(
			"googleapis.com",
		);
		expect(registrableDomain("mistral.ai")).toBe("mistral.ai");
	});

	it("keeps three labels for two-label public suffixes", () => {
		expect(registrableDomain("api.foo.co.uk")).toBe("foo.co.uk");
		expect(registrableDomain("foo.com.cn")).toBe("foo.com.cn");
		// Suffixes beyond the old hardcoded list — must never collapse to the
		// bare suffix, which any email under it would "match".
		expect(registrableDomain("api.foo.co.nz")).toBe("foo.co.nz");
		expect(registrableDomain("api.foo.com.ar")).toBe("foo.com.ar");
		expect(registrableDomain("api.foo.ne.jp")).toBe("foo.ne.jp");
	});

	it("normalizes case and trailing dots", () => {
		expect(registrableDomain("API.Mistral.AI.")).toBe("mistral.ai");
	});
});

describe("emailRegistrableDomain", () => {
	it("extracts the registrable domain of the email host", () => {
		expect(emailRegistrableDomain("ops@mistral.ai")).toBe("mistral.ai");
		expect(emailRegistrableDomain("a@mail.deepseek.com")).toBe("deepseek.com");
	});

	it("returns undefined for malformed emails", () => {
		expect(emailRegistrableDomain("nodomain")).toBeUndefined();
		expect(emailRegistrableDomain("trailing@")).toBeUndefined();
	});
});

describe("providerClaimDomains", () => {
	it("includes the API endpoint domain", () => {
		expect(providerClaimDomains("mistral")).toContain("mistral.ai");
		expect(providerClaimDomains("deepseek")).toContain("deepseek.com");
	});

	it("includes the website domain when it differs from the endpoint", () => {
		// groq's endpoint is api.groq.com and website groq.com — same domain,
		// while zai's endpoint api.z.ai differs from its website z.ai only in
		// subdomain. Use openai to assert the union contains both sources.
		const domains = providerClaimDomains("openai");
		expect(domains).toContain("openai.com");
	});

	it("is empty for unknown providers", () => {
		expect(providerClaimDomains("not-a-provider").size).toBe(0);
	});

	it("never yields a bare public suffix for any catalogue provider", () => {
		// A claim domain equal to its own public suffix would let any email
		// under that suffix "verify" — catch it the moment a provider with such
		// an endpoint/website enters the catalogue.
		for (const provider of providers) {
			for (const domain of providerClaimDomains(provider.id)) {
				expect(
					getPublicSuffix(domain),
					`provider ${provider.id} claim domain ${domain}`,
				).not.toBe(domain);
			}
		}
	});
});

describe("claimableProvidersForEmail", () => {
	it("matches providers by email domain", () => {
		const matches = claimableProvidersForEmail("ops@mistral.ai");
		expect(matches.map((m) => m.providerId)).toContain("mistral");
		expect(matches[0]?.matchedDomain).toBe("mistral.ai");
	});

	it("matches from a subdomain email host", () => {
		const matches = claimableProvidersForEmail("dev@team.deepseek.com");
		expect(matches.map((m) => m.providerId)).toContain("deepseek");
	});

	it("returns nothing for consumer domains", () => {
		expect(claimableProvidersForEmail("someone@gmail.com")).toEqual([]);
	});
});
