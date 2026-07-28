import { describe, expect, it } from "vitest";

import {
	filterCompliantProviders,
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
			consumerTraining: false,
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
