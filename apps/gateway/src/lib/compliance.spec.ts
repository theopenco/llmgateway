import { describe, expect, it } from "vitest";

import {
	filterCompliantProviders,
	getActiveCompliancePolicy,
	isModelIdCompliant,
	isProviderIdCompliant,
} from "./compliance.js";

import type { ProviderCompliancePolicy } from "@llmgateway/models";

const POLICY: ProviderCompliancePolicy = {
	enabled: true,
	requireSoc2: true,
};

describe("isProviderIdCompliant with custom providers", () => {
	it("fails closed for custom without a compliance context", () => {
		expect(isProviderIdCompliant("custom", POLICY)).toBe(false);
		expect(isProviderIdCompliant("custom", POLICY, {})).toBe(false);
		expect(
			isProviderIdCompliant("custom", POLICY, { customAttestation: null }),
		).toBe(false);
	});

	it("allows custom when the attestation satisfies the policy", () => {
		expect(
			isProviderIdCompliant("custom", POLICY, {
				customAttestation: { soc2: 2 },
			}),
		).toBe(true);
	});

	it("blocks custom when the attestation misses a requirement", () => {
		expect(
			isProviderIdCompliant(
				"custom",
				{ enabled: true, blockPromptLogging: true },
				{ customAttestation: { soc2: 2, promptLogging: true } },
			),
		).toBe(false);
	});

	it("never applies the attestation to catalogue providers", () => {
		const fullyCompliant = {
			soc2: 2 as const,
			iso27001: true,
			gdpr: true,
			apiTraining: false,
			promptLogging: false,
			headquarters: "US",
		};
		// deepseek does not hold SOC 2 in the catalogue; a custom attestation
		// must not be able to clear it.
		expect(
			isProviderIdCompliant("deepseek", POLICY, {
				customAttestation: fullyCompliant,
			}),
		).toBe(false);
		// openai is compliant on its own; the context must not change that.
		expect(
			isProviderIdCompliant("openai", POLICY, {
				customAttestation: fullyCompliant,
			}),
		).toBe(isProviderIdCompliant("openai", POLICY));
	});

	it("treats everything as compliant when the policy is disabled", () => {
		expect(isProviderIdCompliant("custom", { enabled: false })).toBe(true);
	});
});

describe("filterCompliantProviders passes context through", () => {
	const list = [
		{ providerId: "openai" },
		{ providerId: "custom" },
		{ providerId: "deepseek" },
	];

	it("drops custom without an attestation", () => {
		expect(
			filterCompliantProviders(list, POLICY).map((p) => p.providerId),
		).toEqual(["openai"]);
	});

	it("keeps custom with a compliant attestation", () => {
		expect(
			filterCompliantProviders(list, POLICY, {
				customAttestation: { soc2: 1 },
			}).map((p) => p.providerId),
		).toEqual(["openai", "custom"]);
	});
});

describe("provider restriction lists", () => {
	it("blocks a catalogue provider on the deny list even when certified", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			blockedProviders: ["openai"],
		};
		expect(isProviderIdCompliant("openai", policy)).toBe(false);
		expect(isProviderIdCompliant("anthropic", policy)).toBe(true);
	});

	it("a non-empty allow list blocks unlisted providers", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			allowedProviders: ["anthropic"],
		};
		expect(isProviderIdCompliant("anthropic", policy)).toBe(true);
		expect(isProviderIdCompliant("openai", policy)).toBe(false);
	});

	it("addresses custom providers as custom:<name>", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			blockedProviders: ["custom:acme"],
		};
		expect(
			isProviderIdCompliant("custom", policy, {
				customAttestation: { soc2: 2 },
				customProviderName: "acme",
			}),
		).toBe(false);
		expect(
			isProviderIdCompliant("custom", policy, {
				customAttestation: { soc2: 2 },
				customProviderName: "other",
			}),
		).toBe(true);
	});

	it("an allow list without the custom ref blocks custom traffic", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			allowedProviders: ["custom:acme"],
		};
		expect(
			isProviderIdCompliant("custom", policy, {
				customAttestation: { soc2: 2 },
				customProviderName: "acme",
			}),
		).toBe(true);
		expect(
			isProviderIdCompliant("custom", policy, {
				customAttestation: { soc2: 2 },
				customProviderName: "other",
			}),
		).toBe(false);
	});

	it("a listed custom provider still needs a compliant attestation", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			requireSoc2: true,
			allowedProviders: ["custom:acme"],
		};
		expect(
			isProviderIdCompliant("custom", policy, {
				customAttestation: null,
				customProviderName: "acme",
			}),
		).toBe(false);
	});
});

describe("isModelIdCompliant", () => {
	it("applies no restriction without model lists", () => {
		expect(isModelIdCompliant("gpt-5.2", { enabled: true })).toBe(true);
	});

	it("blocks models on the deny list", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			blockedModels: ["gpt-5.2"],
		};
		expect(isModelIdCompliant("gpt-5.2", policy)).toBe(false);
		expect(isModelIdCompliant("claude-sonnet-4-6", policy)).toBe(true);
	});

	it("a non-empty allow list blocks unlisted models", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			allowedModels: ["claude-sonnet-4-6"],
		};
		expect(isModelIdCompliant("claude-sonnet-4-6", policy)).toBe(true);
		expect(isModelIdCompliant("gpt-5.2", policy)).toBe(false);
	});

	it("custom-provider models answer to their <provider>/<model> ref", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			blockedModels: ["acme/my-model"],
		};
		expect(
			isModelIdCompliant("my-model", policy, { customProviderName: "acme" }),
		).toBe(false);
		expect(
			isModelIdCompliant("my-model", policy, { customProviderName: "other" }),
		).toBe(true);
		// Without a custom provider the scoped ref never matches.
		expect(isModelIdCompliant("my-model", policy)).toBe(true);
	});

	it("custom-provider models also answer to their bare name", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			blockedModels: ["my-model"],
		};
		expect(
			isModelIdCompliant("my-model", policy, { customProviderName: "acme" }),
		).toBe(false);
	});
});

describe("getActiveCompliancePolicy plan tiers", () => {
	const FULL_POLICY: ProviderCompliancePolicy = {
		enabled: true,
		requireGdpr: true,
		blockApiTraining: true,
		blockPromptLogging: true,
		blockStealthProviders: true,
		allowedCountries: ["DE"],
		requireSoc2: true,
		requireSoc2Type2: true,
		requireIso27001: true,
		blockedProviders: ["deepseek"],
		allowedModels: ["gpt-5.2"],
	};

	it("returns nothing when the policy is disabled, on any plan", () => {
		for (const plan of ["free", "pro", "enterprise"]) {
			expect(
				getActiveCompliancePolicy({
					id: "org-test",
					plan,
					providerCompliancePolicy: { ...FULL_POLICY, enabled: false },
				}),
			).toBeUndefined();
		}
	});

	it("returns nothing when no policy is configured", () => {
		expect(
			getActiveCompliancePolicy({ id: "org-test", plan: "enterprise" }),
		).toBeUndefined();
		expect(
			getActiveCompliancePolicy({
				id: "org-test",
				plan: "pro",
				providerCompliancePolicy: null,
			}),
		).toBeUndefined();
	});

	it("gives enterprise orgs the policy unchanged", () => {
		expect(
			getActiveCompliancePolicy({
				id: "org-test",
				plan: "enterprise",
				providerCompliancePolicy: FULL_POLICY,
			}),
		).toEqual(FULL_POLICY);
	});

	it("honours the data-protection controls on non-enterprise plans", () => {
		for (const plan of ["free", "pro"]) {
			expect(
				getActiveCompliancePolicy({
					id: "org-test",
					plan,
					providerCompliancePolicy: FULL_POLICY,
				}),
			).toEqual({
				enabled: true,
				requireGdpr: true,
				blockApiTraining: true,
				blockPromptLogging: true,
				blockStealthProviders: true,
				allowedCountries: ["DE"],
			});
		}
	});

	it("drops the enterprise-only controls rather than enforcing them", () => {
		const narrowed = getActiveCompliancePolicy({
			id: "org-test",
			plan: "pro",
			providerCompliancePolicy: FULL_POLICY,
		});

		expect(narrowed?.requireSoc2).toBeUndefined();
		expect(narrowed?.requireSoc2Type2).toBeUndefined();
		expect(narrowed?.requireIso27001).toBeUndefined();
		expect(narrowed?.blockedProviders).toBeUndefined();
		expect(narrowed?.allowedModels).toBeUndefined();
	});

	it("returns nothing when only enterprise-only controls are set", () => {
		// Without this the gateway would filter every provider against a policy
		// that can never reject anything, instead of taking the no-policy path.
		expect(
			getActiveCompliancePolicy({
				id: "org-test",
				plan: "pro",
				providerCompliancePolicy: {
					enabled: true,
					requireSoc2: true,
					blockedProviders: ["deepseek"],
				},
			}),
		).toBeUndefined();
	});

	it("actually blocks a non-adequacy provider for a free-plan org", () => {
		// The point of the whole split: a free-plan customer can stop personal
		// data reaching a provider with no GDPR posture.
		const policy = getActiveCompliancePolicy({
			id: "org-test",
			plan: "free",
			providerCompliancePolicy: { enabled: true, requireGdpr: true },
		});

		expect(policy).toBeDefined();
		expect(isProviderIdCompliant("deepseek", policy!)).toBe(false);
		expect(isProviderIdCompliant("openai", policy!)).toBe(true);
	});
});
