import { describe, expect, it } from "vitest";

import {
	getActiveCompliancePolicy,
	getComplianceFailureReasons,
	getEffectiveRetentionLevel,
	isModelIdCompliant,
	isProviderIdCompliant,
} from "./compliance.js";

import type { ProviderCompliancePolicy } from "@llmgateway/models";

const organization = {
	id: "org-test",
	plan: "enterprise",
	retentionLevel: "retain" as const,
};

function resolve(
	orgPolicy: ProviderCompliancePolicy | null,
	keyPolicy: ProviderCompliancePolicy | null,
) {
	return getActiveCompliancePolicy(
		{ ...organization, providerCompliancePolicy: orgPolicy },
		{ providerCompliancePolicy: keyPolicy },
	);
}

const context = {
	customProviderName: "private",
	customAttestation: {
		soc2: 2 as const,
		iso27001: true,
		gdpr: true,
		apiTraining: false,
		promptLogging: false,
		retentionPeriod: "0 days",
		headquarters: "US",
	},
};

describe("API key compliance composition", () => {
	it("uses an enabled key policy with organization policies switched off", () => {
		const keyPolicy = { enabled: true, blockApiTraining: true };
		expect(resolve({ enabled: false, requireGdpr: true }, keyPolicy)).toEqual(
			keyPolicy,
		);
		expect(resolve(null, keyPolicy)).toEqual(keyPolicy);
	});

	it("cannot disable an enabled organization policy", () => {
		const orgPolicy = { enabled: true, requireGdpr: true };
		expect(resolve(orgPolicy, { enabled: false })).toEqual(orgPolicy);
		expect(resolve(null, { enabled: false })).toBeUndefined();
	});

	it("keeps organization requirements when the key explicitly turns them off", () => {
		const policy = resolve(
			{ enabled: true, requireGdpr: true },
			{ enabled: true, requireGdpr: false },
		)!;
		expect(
			isProviderIdCompliant("custom", policy, {
				...context,
				customAttestation: { ...context.customAttestation, gdpr: false },
			}),
		).toBe(false);
	});

	it("adds key requirements without discarding organization requirements", () => {
		const policy = resolve(
			{ enabled: true, requireGdpr: true },
			{ enabled: true, requireIso27001: true },
		)!;
		expect(isProviderIdCompliant("custom", policy, context)).toBe(true);
		for (const missing of [{ gdpr: false }, { iso27001: false }]) {
			expect(
				isProviderIdCompliant("custom", policy, {
					...context,
					customAttestation: { ...context.customAttestation, ...missing },
				}),
			).toBe(false);
		}
	});

	it.each(["allowedCountries", "allowedProviders"] as const)(
		"disjoint %s deny all rather than becoming unrestricted",
		(field) => {
			const values =
				field === "allowedCountries"
					? [["US"], ["DE"]]
					: [["custom:private"], ["custom:other"]];
			const policy = resolve(
				{ enabled: true, [field]: values[0] },
				{ enabled: true, [field]: values[1] },
			)!;
			expect(isProviderIdCompliant("custom", policy, context)).toBe(false);
		},
	);

	it("disjoint model allowlists deny all", () => {
		const policy = resolve(
			{ enabled: true, allowedModels: ["model-a"] },
			{ enabled: true, allowedModels: ["model-b"] },
		)!;
		expect(isModelIdCompliant("model-a", policy)).toBe(false);
		expect(isModelIdCompliant("model-b", policy)).toBe(false);
	});

	it("evaluates custom model aliases against each policy independently", () => {
		const policy = resolve(
			{ enabled: true, allowedModels: ["model-a"] },
			{ enabled: true, allowedModels: ["private/model-a"] },
		)!;
		expect(isModelIdCompliant("model-a", policy, context)).toBe(true);
		expect(isModelIdCompliant("model-b", policy, context)).toBe(false);
	});

	it.each([true, false])(
		"preserves blocklists from both levels (org=%s)",
		(org) => {
			const block = {
				enabled: true,
				blockedProviders: ["custom:private"],
				blockedModels: ["model-a"],
			};
			const allow = {
				enabled: true,
				allowedProviders: ["custom:private"],
				allowedModels: ["model-a"],
			};
			const policy = resolve(org ? block : allow, org ? allow : block)!;
			expect(isProviderIdCompliant("custom", policy, context)).toBe(false);
			expect(isModelIdCompliant("model-a", policy)).toBe(false);
		},
	);

	it("an empty key allowlist cannot remove an organization allowlist", () => {
		const policy = resolve(
			{ enabled: true, allowedProviders: ["custom:private"] },
			{ enabled: true, allowedProviders: [] },
		)!;
		expect(isProviderIdCompliant("custom", policy, context)).toBe(true);
		expect(
			isProviderIdCompliant("custom", policy, {
				...context,
				customProviderName: "other",
			}),
		).toBe(false);
	});

	it("reports violations from both levels without duplicate reasons", () => {
		const policy = resolve(
			{ enabled: true, requireGdpr: true, blockedModels: ["model-a"] },
			{ enabled: true, requireGdpr: true, requireIso27001: true },
		)!;
		const failures = getComplianceFailureReasons("custom", "model-a", policy, {
			...context,
			customAttestation: {
				...context.customAttestation,
				gdpr: false,
				iso27001: false,
			},
		});
		expect(failures).toEqual(
			expect.arrayContaining([
				"requireGdpr",
				"requireIso27001",
				"blockedModels",
			]),
		);
		expect(new Set(failures).size).toBe(failures.length);
	});

	it.each(["free", "pro", "enterprise"])(
		"fails closed after plan changes to %s",
		(plan) => {
			const keyPolicy = { enabled: true, requireGdpr: true };
			expect(
				getActiveCompliancePolicy(
					{ ...organization, plan },
					{ providerCompliancePolicy: keyPolicy },
				),
			).toEqual(keyPolicy);
		},
	);

	it("key ZDR disables payload retention without changing organization settings", () => {
		const key = {
			providerCompliancePolicy: { enabled: true, zeroDataRetention: true },
		};
		expect(getEffectiveRetentionLevel(organization, key)).toBe("none");
		expect(getEffectiveRetentionLevel(organization)).toBe("retain");
	});

	it("key cannot weaken organization ZDR", () => {
		expect(
			getEffectiveRetentionLevel(
				{
					...organization,
					providerCompliancePolicy: { enabled: true, zeroDataRetention: true },
				},
				{
					providerCompliancePolicy: { enabled: true, zeroDataRetention: false },
				},
			),
		).toBe("none");
	});
});

describe("virtual aliases under organization and key policies", () => {
	const model = "deepseek-v4.1-flash-1017";
	const alias = "deepseek-v4.1-flash-latest";

	it.each([true, false])(
		"alias block at organization=%s cannot be widened by the other policy",
		(orgBlocks) => {
			const blocked = { enabled: true, blockedModels: [alias] };
			const allowed = { enabled: true, allowedModels: [model] };
			const policy = resolve(
				orgBlocks ? blocked : allowed,
				orgBlocks ? allowed : blocked,
			)!;
			expect(isModelIdCompliant(model, policy)).toBe(false);
			expect(getComplianceFailureReasons("tencent", model, policy)).toContain(
				"blockedModels",
			);
		},
	);

	it("an alias-only key allowlist cannot widen the organization model allowlist", () => {
		const policy = resolve(
			{ enabled: true, allowedModels: [model] },
			{ enabled: true, allowedModels: [alias] },
		)!;
		expect(isModelIdCompliant(model, policy)).toBe(false);
	});

	it("a disabled key alias restriction leaves the organization policy unchanged", () => {
		const orgPolicy = { enabled: true, allowedModels: [model] };
		const policy = resolve(orgPolicy, {
			enabled: false,
			blockedModels: [alias],
		})!;
		expect(policy).toBe(orgPolicy);
		expect(isModelIdCompliant(model, policy)).toBe(true);
	});
});
