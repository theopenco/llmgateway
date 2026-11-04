import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as database from "@llmgateway/db";
import { providers } from "@llmgateway/models";

import * as cachedQueries from "./cached-queries.js";
import {
	getActiveCompliancePolicy,
	getEffectiveRetentionLevel,
	isZeroDataRetentionEnabled,
	isModelIdCompliant,
	isProviderIdCompliant,
	withDpaEnforcement,
} from "./compliance.js";

import type { ProviderCompliancePolicy } from "@llmgateway/models";

const organization = {
	id: "org-test",
	plan: "enterprise",
	retentionLevel: "retain" as const,
};
const gdpr = { enabled: true, requireGdpr: true };
const enabled = { enabled: true };
const scopes: {
	name: string;
	org: ProviderCompliancePolicy | null;
	key: ProviderCompliancePolicy | null;
}[] = [
	{ name: "organization only", org: gdpr, key: null },
	{ name: "key only", org: null, key: gdpr },
	{ name: "organization GDPR with enabled key", org: gdpr, key: enabled },
	{ name: "key GDPR with enabled organization", org: enabled, key: gdpr },
	{ name: "both GDPR", org: gdpr, key: gdpr },
];
function policy(
	org: ProviderCompliancePolicy | null,
	key: ProviderCompliancePolicy | null,
	plan = "enterprise",
) {
	return getActiveCompliancePolicy(
		{ ...organization, plan, providerCompliancePolicy: org },
		{ providerCompliancePolicy: key },
	);
}

describe("signed DPA policy composition", () => {
	beforeEach(() => {
		vi.stubEnv("REQUIRE_PROVIDER_DPA_FOR_GDPR", "true");
		vi.stubEnv("API_KEY_COMPLIANCE_ENABLED", "false");
		vi.spyOn(database, "getEffectiveProviders").mockResolvedValue([
			...providers,
		]);
		vi.spyOn(cachedQueries, "findDpaSignedProviderIds").mockResolvedValue([]);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});
	it.each(scopes)(
		"$name: no signature denies an otherwise eligible provider",
		async ({ org, key }) => {
			const result = await withDpaEnforcement(policy(org, key));
			expect(result).toBeDefined();
			expect(isProviderIdCompliant("openai", result!)).toBe(false);
		},
	);
	it.each(scopes)(
		"$name: signature allows without weakening the source policies",
		async ({ org, key }) => {
			vi.mocked(cachedQueries.findDpaSignedProviderIds).mockResolvedValue([
				"openai",
			]);
			const result = await withDpaEnforcement(policy(org, key));
			expect(isProviderIdCompliant("openai", result!)).toBe(true);
		},
	);
	it.each(scopes)(
		"$name: lookup failure cannot reuse a former grant",
		async ({ org, key }) => {
			vi.mocked(cachedQueries.findDpaSignedProviderIds)
				.mockResolvedValueOnce(["openai"])
				.mockRejectedValueOnce(new Error("Synthetic DPA store outage"));
			expect(
				isProviderIdCompliant(
					"openai",
					(await withDpaEnforcement(policy(org, key)))!,
				),
			).toBe(true);
			await expect(withDpaEnforcement(policy(org, key))).rejects.toThrow(
				"Synthetic DPA store outage",
			);
			// Cache/SWR expiry behavior is separately exercised by cached-queries.spec.ts.
		},
	);
	it("does not add an operator-disabled DPA gate", async () => {
		vi.stubEnv("REQUIRE_PROVIDER_DPA_FOR_GDPR", "false");
		const result = await withDpaEnforcement(policy(gdpr, enabled));
		expect(isProviderIdCompliant("openai", result!)).toBe(true);
		expect(cachedQueries.findDpaSignedProviderIds).not.toHaveBeenCalled();
	});
	it("does not fetch signatures when no enabled scope requires GDPR", async () => {
		const result = await withDpaEnforcement(policy(enabled, enabled));
		expect(isProviderIdCompliant("openai", result!)).toBe(true);
		expect(cachedQueries.findDpaSignedProviderIds).not.toHaveBeenCalled();
	});
	it("ignores a disabled GDPR scope but not an enabled floor", async () => {
		const result = await withDpaEnforcement(
			policy({ enabled: false, requireGdpr: true }, enabled),
		);
		expect(isProviderIdCompliant("openai", result!)).toBe(true);
		expect(cachedQueries.findDpaSignedProviderIds).not.toHaveBeenCalled();
	});
	it.each(["organization", "apiKey"])(
		"preserves ZDR OR semantics from %s",
		async (source) => {
			const orgPolicy = {
				...gdpr,
				zeroDataRetention: source === "organization",
			};
			const keyPolicy = { ...enabled, zeroDataRetention: source === "apiKey" };
			const result = await withDpaEnforcement(policy(orgPolicy, keyPolicy));
			expect(result?.zeroDataRetention).toBe(true);
			const org = { ...organization, providerCompliancePolicy: orgPolicy };
			const key = { providerCompliancePolicy: keyPolicy };
			expect(isZeroDataRetentionEnabled(org, key)).toBe(true);
			expect(getEffectiveRetentionLevel(org, key)).toBe("none");
		},
	);
	it("does not flatten disjoint allowlists into an unrestricted policy", async () => {
		vi.mocked(cachedQueries.findDpaSignedProviderIds).mockResolvedValue([
			"openai",
			"anthropic",
		]);
		const result = await withDpaEnforcement(
			policy(
				{ ...gdpr, allowedProviders: ["openai"] },
				{ ...gdpr, allowedProviders: ["anthropic"] },
			),
		);
		expect(isProviderIdCompliant("openai", result!)).toBe(false);
		expect(isProviderIdCompliant("anthropic", result!)).toBe(false);
	});
	it.each(["free", "pro"])(
		"keeps inherited restrictions after downgrade to %s and writes-off",
		async (plan) => {
			vi.mocked(cachedQueries.findDpaSignedProviderIds).mockResolvedValue([
				"openai",
			]);
			const result = await withDpaEnforcement(
				policy(gdpr, { enabled: true, blockedProviders: ["openai"] }, plan),
			);
			expect(isProviderIdCompliant("openai", result!)).toBe(false);
		},
	);
	it("keeps custom attestation and both model/provider floors", async () => {
		const context = {
			customProviderName: "private",
			customAttestation: {
				gdpr: true,
				apiTraining: false,
				promptLogging: false,
				retentionPeriod: "0 days",
				headquarters: "US",
			},
		};
		const result = await withDpaEnforcement(
			policy(gdpr, {
				enabled: true,
				allowedProviders: ["custom:private"],
				allowedModels: ["private/model-a"],
			}),
		);
		expect(isProviderIdCompliant("custom", result!, context)).toBe(true);
		expect(
			isProviderIdCompliant("custom", result!, {
				...context,
				customAttestation: null,
			}),
		).toBe(false);
		expect(isModelIdCompliant("model-a", result!, context)).toBe(true);
		expect(isModelIdCompliant("model-b", result!, context)).toBe(false);
	});
});
it("a signature does not manufacture a GDPR posture", async () => {
	const original = providers.find((provider) => provider.id === "openai")!;
	const unconfirmed = {
		...original,
		id: "synthetic-unconfirmed",
		dataPolicy: {
			...original.dataPolicy,
			apiTraining: original.dataPolicy?.apiTraining ?? null,
			promptLogging: original.dataPolicy?.promptLogging ?? null,
			retentionPeriod: original.dataPolicy?.retentionPeriod ?? null,
			gdpr: null,
		},
	};
	const catalogue = vi
		.spyOn(database, "getEffectiveProviders")
		.mockResolvedValue([unconfirmed]);
	const signatures = vi
		.spyOn(cachedQueries, "findDpaSignedProviderIds")
		.mockResolvedValue([unconfirmed.id]);
	vi.stubEnv("REQUIRE_PROVIDER_DPA_FOR_GDPR", "true");
	try {
		const result = await withDpaEnforcement(policy(gdpr, enabled));
		expect(
			isProviderIdCompliant(unconfirmed.id, result!, {
				effectiveProviders: [unconfirmed],
			}),
		).toBe(false);
	} finally {
		catalogue.mockRestore();
		signatures.mockRestore();
		vi.unstubAllEnvs();
	}
});
