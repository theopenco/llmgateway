import { describe, expect, it } from "vitest";

import {
	countryCodeToFlag,
	customProviderRef,
	getAttestationComplianceFailures,
	getProviderComplianceFailures,
	getProviderCountries,
	getProviderDefinition,
	getProviderRefPolicyListFailures,
	isAttestationCompliant,
	isModelAllowedByPolicy,
	isProviderCompliant,
	isProviderRefAllowedByPolicy,
	isStealthProvider,
	PROVIDER_COUNTRY_NAMES,
	providers,
	type ProviderComplianceAttestation,
	type ProviderCompliancePolicy,
	type ProviderDefinition,
} from "./providers.js";

/** True when `s` is exactly two Unicode regional-indicator symbols (a flag). */
function isFlagEmoji(s: string): boolean {
	const codePoints = Array.from(s, (ch) => ch.codePointAt(0) ?? 0);
	return (
		codePoints.length === 2 &&
		codePoints.every((cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff)
	);
}

/** Distinct, non-null provider-headquarters country codes in the catalogue. */
const HEADQUARTERS_CODES = Array.from(
	new Set(
		providers
			.map((p) => p.headquarters)
			.filter((c): c is string => typeof c === "string" && c.length > 0),
	),
);

function makeProvider(
	dataPolicy: ProviderDefinition["dataPolicy"],
	headquarters?: string | null,
): ProviderDefinition {
	return {
		id: "test",
		name: "Test",
		description: "",
		forwardsSafetyIdentifier: false,
		env: { required: { apiKey: "TEST" } },
		legalEntity: null,
		dataPolicy,
		headquarters,
	};
}

describe("isProviderCompliant", () => {
	it("treats every provider as compliant when the policy is disabled", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: false,
			requireSoc2: true,
		};
		expect(isProviderCompliant(makeProvider(null), policy)).toBe(true);
	});

	it("fails closed when dataPolicy is missing", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			requireSoc2: true,
		};
		expect(isProviderCompliant(makeProvider(null), policy)).toBe(false);
		expect(isProviderCompliant(makeProvider(undefined), policy)).toBe(false);
	});

	it("requires each active attribute to be explicitly satisfied", () => {
		const provider = makeProvider({
			apiTraining: true,
			promptLogging: true,
			soc2: 2,
		});
		expect(
			isProviderCompliant(provider, { enabled: true, requireSoc2: true }),
		).toBe(true);
		expect(
			isProviderCompliant(provider, { enabled: true, requireGdpr: true }),
		).toBe(false);
		expect(
			isProviderCompliant(provider, { enabled: true, blockApiTraining: true }),
		).toBe(false);
		expect(
			isProviderCompliant(provider, {
				enabled: true,
				blockPromptLogging: true,
			}),
		).toBe(false);
	});

	it("blockApiTraining requires apiTraining === false (unknown fails)", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			blockApiTraining: true,
		};
		expect(
			isProviderCompliant(
				makeProvider({
					apiTraining: false,
					promptLogging: false,
				}),
				policy,
			),
		).toBe(true);
		expect(
			isProviderCompliant(
				makeProvider({
					apiTraining: null,
					promptLogging: null,
				}),
				policy,
			),
		).toBe(false);
	});

	it("requireSoc2OrIso27001 requires SOC 2 Type 2 or ISO 27001", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			requireSoc2OrIso27001: true,
		};
		// SOC 2 Type 2 → allowed.
		expect(
			isProviderCompliant(
				makeProvider({
					apiTraining: false,
					promptLogging: false,
					soc2: 2,
				}),
				policy,
			),
		).toBe(true);
		// ISO 27001 → allowed.
		expect(
			isProviderCompliant(
				makeProvider({
					apiTraining: false,
					promptLogging: false,
					iso27001: true,
				}),
				policy,
			),
		).toBe(true);
		// SOC 2 Type 1 only (no ISO) → blocked: Type 1 does not satisfy this toggle.
		expect(
			isProviderCompliant(
				makeProvider({
					apiTraining: false,
					promptLogging: false,
					soc2: 1,
				}),
				policy,
			),
		).toBe(false);
		// Neither → blocked.
		expect(
			isProviderCompliant(
				makeProvider({
					apiTraining: false,
					promptLogging: false,
				}),
				policy,
			),
		).toBe(false);
	});

	it("distinguishes SOC 2 Type 1 from Type 2", () => {
		const type1 = makeProvider({
			apiTraining: false,
			promptLogging: false,
			soc2: 1,
		});
		const type2 = makeProvider({
			apiTraining: false,
			promptLogging: false,
			soc2: 2,
		});
		// requireSoc2 accepts any SOC 2 report (Type 1 or Type 2).
		expect(
			isProviderCompliant(type1, { enabled: true, requireSoc2: true }),
		).toBe(true);
		expect(
			isProviderCompliant(type2, { enabled: true, requireSoc2: true }),
		).toBe(true);
		// requireSoc2Type2 accepts only Type 2.
		expect(
			isProviderCompliant(type1, { enabled: true, requireSoc2Type2: true }),
		).toBe(false);
		expect(
			isProviderCompliant(type2, { enabled: true, requireSoc2Type2: true }),
		).toBe(true);
		// A provider with no SOC 2 report fails both.
		const none = makeProvider({
			apiTraining: false,
			promptLogging: false,
		});
		expect(
			isProviderCompliant(none, { enabled: true, requireSoc2Type2: true }),
		).toBe(false);
	});

	it("requireSoc2Type2 allows a real Type 2 provider (canopywave)", () => {
		// canopywave holds SOC 2 Type 2; it passes both requireSoc2 and requireSoc2Type2.
		const canopywave = getProviderDefinition("canopywave")!;
		expect(canopywave.dataPolicy?.soc2).toBe(2);
		expect(
			isProviderCompliant(canopywave, { enabled: true, requireSoc2: true }),
		).toBe(true);
		expect(
			isProviderCompliant(canopywave, {
				enabled: true,
				requireSoc2Type2: true,
			}),
		).toBe(true);
	});

	it("blocks a non-compliant real provider and allows a compliant one", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			requireSoc2: true,
			blockApiTraining: true,
		};
		const openai = getProviderDefinition("openai")!;
		const deepseek = getProviderDefinition("deepseek")!;
		expect(isProviderCompliant(openai, policy)).toBe(true);
		expect(isProviderCompliant(deepseek, policy)).toBe(false);
	});

	it("allowedCountries restricts routing to the selected headquarters", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			allowedCountries: ["US"],
		};
		expect(isProviderCompliant(makeProvider(null, "US"), policy)).toBe(true);
		expect(isProviderCompliant(makeProvider(null, "CN"), policy)).toBe(false);
	});

	it("allowedCountries fails closed for an unknown headquarters", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			allowedCountries: ["US"],
		};
		expect(isProviderCompliant(makeProvider(null, null), policy)).toBe(false);
		expect(isProviderCompliant(makeProvider(null, undefined), policy)).toBe(
			false,
		);
	});

	it("an empty allowedCountries list applies no country restriction", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			allowedCountries: [],
		};
		expect(isProviderCompliant(makeProvider(null, "CN"), policy)).toBe(true);
		expect(isProviderCompliant(makeProvider(null, null), policy)).toBe(true);
	});

	it("composes the country filter with certification requirements", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			requireSoc2: true,
			allowedCountries: ["US"],
		};
		const compliant = makeProvider(
			{
				apiTraining: false,
				promptLogging: false,
				soc2: 2,
			},
			"US",
		);
		// Same certs, wrong country → blocked.
		const wrongCountry = makeProvider(
			{
				apiTraining: false,
				promptLogging: false,
				soc2: 2,
			},
			"CN",
		);
		expect(isProviderCompliant(compliant, policy)).toBe(true);
		expect(isProviderCompliant(wrongCountry, policy)).toBe(false);
	});
});

describe("isProviderRefAllowedByPolicy", () => {
	it("applies no restriction when the policy is disabled or has no lists", () => {
		expect(
			isProviderRefAllowedByPolicy("openai", {
				enabled: false,
				blockedProviders: ["openai"],
			}),
		).toBe(true);
		expect(isProviderRefAllowedByPolicy("openai", { enabled: true })).toBe(
			true,
		);
	});

	it("blocks providers on the deny list", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			blockedProviders: ["openai", customProviderRef("acme")],
		};
		expect(isProviderRefAllowedByPolicy("openai", policy)).toBe(false);
		expect(isProviderRefAllowedByPolicy("custom:acme", policy)).toBe(false);
		expect(isProviderRefAllowedByPolicy("anthropic", policy)).toBe(true);
		expect(isProviderRefAllowedByPolicy("custom:other", policy)).toBe(true);
	});

	it("a non-empty allow list blocks everything not on it", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			allowedProviders: ["anthropic", customProviderRef("acme")],
		};
		expect(isProviderRefAllowedByPolicy("anthropic", policy)).toBe(true);
		expect(isProviderRefAllowedByPolicy("custom:acme", policy)).toBe(true);
		expect(isProviderRefAllowedByPolicy("openai", policy)).toBe(false);
		expect(isProviderRefAllowedByPolicy("custom:other", policy)).toBe(false);
	});

	it("an empty allow list applies no restriction", () => {
		expect(
			isProviderRefAllowedByPolicy("openai", {
				enabled: true,
				allowedProviders: [],
			}),
		).toBe(true);
	});

	it("the deny list wins over the allow list", () => {
		expect(
			isProviderRefAllowedByPolicy("openai", {
				enabled: true,
				allowedProviders: ["openai"],
				blockedProviders: ["openai"],
			}),
		).toBe(false);
	});
});

describe("isModelAllowedByPolicy", () => {
	it("applies no restriction when the policy is disabled or has no lists", () => {
		expect(
			isModelAllowedByPolicy(["gpt-5.2"], {
				enabled: false,
				blockedModels: ["gpt-5.2"],
			}),
		).toBe(true);
		expect(isModelAllowedByPolicy(["gpt-5.2"], { enabled: true })).toBe(true);
	});

	it("blocks a model when any of its refs is on the deny list", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			blockedModels: ["acme/my-model"],
		};
		expect(isModelAllowedByPolicy(["my-model", "acme/my-model"], policy)).toBe(
			false,
		);
		expect(isModelAllowedByPolicy(["my-model", "other/my-model"], policy)).toBe(
			true,
		);
	});

	it("a non-empty allow list requires one matching ref", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			allowedModels: ["claude-sonnet-4-6", "acme/my-model"],
		};
		expect(isModelAllowedByPolicy(["claude-sonnet-4-6"], policy)).toBe(true);
		expect(isModelAllowedByPolicy(["my-model", "acme/my-model"], policy)).toBe(
			true,
		);
		expect(isModelAllowedByPolicy(["gpt-5.2"], policy)).toBe(false);
	});

	it("an empty allow list applies no restriction", () => {
		expect(
			isModelAllowedByPolicy(["gpt-5.2"], { enabled: true, allowedModels: [] }),
		).toBe(true);
	});

	it("the deny list wins over the allow list", () => {
		expect(
			isModelAllowedByPolicy(["gpt-5.2"], {
				enabled: true,
				allowedModels: ["gpt-5.2"],
				blockedModels: ["gpt-5.2"],
			}),
		).toBe(false);
	});
});

describe("isProviderCompliant with provider lists", () => {
	const compliantDataPolicy = {
		apiTraining: false,
		promptLogging: false,
		soc2: 2 as const,
	};

	it("blocks a listed provider even when it meets every requirement", () => {
		const provider = makeProvider(compliantDataPolicy, "US");
		expect(
			isProviderCompliant(provider, {
				enabled: true,
				requireSoc2: true,
				blockedProviders: ["test"],
			}),
		).toBe(false);
	});

	it("still requires certifications for allow-listed providers", () => {
		const uncertified = makeProvider(null, "US");
		expect(
			isProviderCompliant(uncertified, {
				enabled: true,
				requireSoc2: true,
				allowedProviders: ["test"],
			}),
		).toBe(false);
		const certified = makeProvider(compliantDataPolicy, "US");
		expect(
			isProviderCompliant(certified, {
				enabled: true,
				requireSoc2: true,
				allowedProviders: ["test"],
			}),
		).toBe(true);
	});

	it("blocks providers absent from a non-empty allow list", () => {
		const provider = makeProvider(compliantDataPolicy, "US");
		expect(
			isProviderCompliant(provider, {
				enabled: true,
				allowedProviders: ["anthropic"],
			}),
		).toBe(false);
	});
});

describe("isAttestationCompliant", () => {
	it("treats any attestation (including none) as compliant when the policy is disabled", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: false,
			requireSoc2: true,
		};
		expect(isAttestationCompliant(undefined, policy)).toBe(true);
		expect(isAttestationCompliant(null, policy)).toBe(true);
		expect(isAttestationCompliant({ soc2: 2 }, policy)).toBe(true);
	});

	it("fails closed when no attestation is on file", () => {
		expect(
			isAttestationCompliant(null, { enabled: true, requireSoc2: true }),
		).toBe(false);
		expect(
			isAttestationCompliant(undefined, { enabled: true, requireGdpr: true }),
		).toBe(false);
		expect(
			isAttestationCompliant(null, {
				enabled: true,
				allowedCountries: ["US"],
			}),
		).toBe(false);
	});

	it("an empty attestation fails every single-requirement policy", () => {
		const singleRequirementPolicies: ProviderCompliancePolicy[] = [
			{ enabled: true, requireSoc2: true },
			{ enabled: true, requireSoc2Type2: true },
			{ enabled: true, requireIso27001: true },
			{ enabled: true, requireSoc2OrIso27001: true },
			{ enabled: true, requireGdpr: true },
			{ enabled: true, blockApiTraining: true },
			{ enabled: true, blockPromptLogging: true },
			{ enabled: true, zeroDataRetention: true },
			{ enabled: true, allowedCountries: ["US"] },
		];
		for (const policy of singleRequirementPolicies) {
			expect(isAttestationCompliant({}, policy)).toBe(false);
		}
	});

	it("evaluates SOC 2 report types like catalogue providers", () => {
		expect(
			isAttestationCompliant({ soc2: 2 }, { enabled: true, requireSoc2: true }),
		).toBe(true);
		expect(
			isAttestationCompliant(
				{ soc2: 2 },
				{ enabled: true, requireSoc2Type2: true },
			),
		).toBe(true);
		expect(
			isAttestationCompliant(
				{ soc2: 2 },
				{ enabled: true, requireSoc2OrIso27001: true },
			),
		).toBe(true);
		expect(
			isAttestationCompliant({ soc2: 1 }, { enabled: true, requireSoc2: true }),
		).toBe(true);
		expect(
			isAttestationCompliant(
				{ soc2: 1 },
				{ enabled: true, requireSoc2Type2: true },
			),
		).toBe(false);
		expect(
			isAttestationCompliant(
				{ soc2: 1 },
				{ enabled: true, requireSoc2OrIso27001: true },
			),
		).toBe(false);
	});

	it("blockApiTraining / blockPromptLogging require an explicit false", () => {
		expect(
			isAttestationCompliant(
				{ apiTraining: false },
				{ enabled: true, blockApiTraining: true },
			),
		).toBe(true);
		expect(
			isAttestationCompliant(
				{ apiTraining: null },
				{ enabled: true, blockApiTraining: true },
			),
		).toBe(false);
		expect(
			isAttestationCompliant(
				{ apiTraining: true },
				{ enabled: true, blockApiTraining: true },
			),
		).toBe(false);
		expect(
			isAttestationCompliant(
				{ promptLogging: false },
				{ enabled: true, blockPromptLogging: true },
			),
		).toBe(true);
		expect(
			isAttestationCompliant(
				{ promptLogging: null },
				{ enabled: true, blockPromptLogging: true },
			),
		).toBe(false);
		expect(
			isAttestationCompliant(
				{ promptLogging: true },
				{ enabled: true, blockPromptLogging: true },
			),
		).toBe(false);
	});

	it("zeroDataRetention requires no prompt logging and zero retention", () => {
		expect(
			isAttestationCompliant(
				{ promptLogging: false, retentionPeriod: "0 days" },
				{ enabled: true, zeroDataRetention: true },
			),
		).toBe(true);
		expect(
			isAttestationCompliant(
				{ promptLogging: false, retentionPeriod: "24 hours" },
				{ enabled: true, zeroDataRetention: true },
			),
		).toBe(false);
		expect(
			getAttestationComplianceFailures(
				{ promptLogging: true, retentionPeriod: "0 days" },
				{ enabled: true, zeroDataRetention: true },
			),
		).toEqual(["zeroDataRetention"]);
		expect(
			getAttestationComplianceFailures(
				{ promptLogging: false },
				{ enabled: true, zeroDataRetention: true },
			),
		).toEqual(["zeroDataRetention"]);
		expect(
			getProviderComplianceFailures(getProviderDefinition("bytedance")!, {
				enabled: true,
				zeroDataRetention: true,
			}),
		).toContain("zeroDataRetention");
	});

	it("allowedCountries checks the attested headquarters, failing closed when absent", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			allowedCountries: ["US"],
		};
		expect(isAttestationCompliant({ headquarters: "US" }, policy)).toBe(true);
		expect(isAttestationCompliant({ headquarters: "CN" }, policy)).toBe(false);
		expect(isAttestationCompliant({ headquarters: null }, policy)).toBe(false);
		expect(isAttestationCompliant({}, policy)).toBe(false);
	});

	it("matches isProviderCompliant for an equivalent catalogue provider (parity guard)", () => {
		const openai = getProviderDefinition("openai")!;
		const attestation: ProviderComplianceAttestation = {
			soc2: openai.dataPolicy?.soc2 ?? null,
			iso27001: openai.dataPolicy?.iso27001 ?? null,
			gdpr: openai.dataPolicy?.gdpr ?? null,
			apiTraining: openai.dataPolicy?.apiTraining ?? null,
			promptLogging: openai.dataPolicy?.promptLogging ?? null,
			retentionPeriod: openai.dataPolicy?.retentionPeriod ?? null,
			headquarters: openai.headquarters ?? null,
		};
		const policies: ProviderCompliancePolicy[] = [
			{ enabled: false },
			{ enabled: true },
			{ enabled: true, requireSoc2: true },
			{ enabled: true, requireSoc2Type2: true },
			{ enabled: true, requireIso27001: true },
			{ enabled: true, requireSoc2OrIso27001: true },
			{ enabled: true, requireGdpr: true },
			{ enabled: true, blockApiTraining: true },
			{ enabled: true, blockPromptLogging: true },
			{ enabled: true, allowedCountries: ["US"] },
			{ enabled: true, allowedCountries: ["FR"] },
			{ enabled: true, requireSoc2: true, blockApiTraining: true },
			{
				enabled: true,
				requireSoc2Type2: true,
				blockPromptLogging: true,
				allowedCountries: ["US"],
			},
		];
		for (const policy of policies) {
			expect(
				isAttestationCompliant(attestation, policy),
				`attestation/provider divergence for policy ${JSON.stringify(policy)}`,
			).toBe(isProviderCompliant(openai, policy));
		}
	});
});

describe("getProviderCountries", () => {
	it("returns only distinct countries referenced by the catalogue, sorted by name", () => {
		const countries = getProviderCountries();
		const codes = countries.map((c) => c.code);
		expect(new Set(codes).size).toBe(codes.length);
		expect(codes).toContain("US");
		expect(codes).toContain("CN");
		expect(codes).not.toContain(null);
		const names = countries.map((c) => c.name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
	});

	it("derives a flag emoji for each country", () => {
		for (const country of getProviderCountries()) {
			expect(country.flag.length).toBeGreaterThan(0);
		}
		expect(countryCodeToFlag("US")).toBe("🇺🇸");
		expect(countryCodeToFlag("FR")).toBe("🇫🇷");
	});
});

// Guards against silent drift: any new provider `headquarters` value added to
// the catalogue must also get a display-name entry and produce a valid flag,
// otherwise the compliance country selector would show a bare code / broken
// flag. These tests fail loudly when a mapping is missing.
describe("provider headquarters country mappings are complete", () => {
	it("has at least one headquarters country in the catalogue", () => {
		expect(HEADQUARTERS_CODES.length).toBeGreaterThan(0);
	});

	it.each(HEADQUARTERS_CODES)("has a display-name mapping for %s", (code) => {
		const name = PROVIDER_COUNTRY_NAMES[code];
		expect(
			name,
			`Missing PROVIDER_COUNTRY_NAMES entry for headquarters "${code}". Add it in packages/models/src/providers.ts.`,
		).toBeTruthy();
		// The name must be a real label, not just the raw code echoed back.
		expect(name).not.toBe(code);
	});

	it.each(HEADQUARTERS_CODES)("produces a valid flag emoji for %s", (code) => {
		expect(
			isFlagEmoji(countryCodeToFlag(code)),
			`countryCodeToFlag("${code}") did not produce a valid flag emoji.`,
		).toBe(true);
	});

	it("does not define names for codes absent from the catalogue", () => {
		// Keeps the map lean and honest: no stale entries for retired countries.
		const catalogue = new Set(HEADQUARTERS_CODES);
		const orphans = Object.keys(PROVIDER_COUNTRY_NAMES).filter(
			(code) => !catalogue.has(code),
		);
		expect(
			orphans,
			`PROVIDER_COUNTRY_NAMES has entries for codes no provider uses: ${orphans.join(", ")}`,
		).toEqual([]);
	});
});

describe("compliance failure reasons", () => {
	it("reports every unmet requirement for a provider", () => {
		const provider = makeProvider(
			{
				apiTraining: true,
				promptLogging: true,
				soc2: 1,
			},
			"CN",
		);
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			requireSoc2Type2: true,
			blockApiTraining: true,
			blockPromptLogging: true,
			allowedCountries: ["US"],
		};
		expect(getProviderComplianceFailures(provider, policy)).toEqual([
			"requireSoc2Type2",
			"blockApiTraining",
			"blockPromptLogging",
			"allowedCountries",
		]);
	});

	it("is empty for compliant providers and disabled policies", () => {
		const provider = makeProvider(
			{
				apiTraining: false,
				promptLogging: false,
				soc2: 2,
			},
			"US",
		);
		expect(
			getProviderComplianceFailures(provider, {
				enabled: true,
				requireSoc2Type2: true,
				blockApiTraining: true,
				allowedCountries: ["US"],
			}),
		).toEqual([]);
		expect(
			getProviderComplianceFailures(makeProvider(null), {
				enabled: false,
				requireSoc2: true,
			}),
		).toEqual([]);
	});

	it("reports allow-list exclusion when only a custom provider is allowed", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			allowedProviders: [customProviderRef("bedrock")],
		};
		expect(getProviderRefPolicyListFailures("openai", policy)).toEqual([
			"allowedProviders",
		]);
		expect(
			getProviderRefPolicyListFailures(customProviderRef("bedrock"), policy),
		).toEqual([]);
	});

	it("reports deny-list hits", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			blockedProviders: ["openai"],
		};
		expect(getProviderRefPolicyListFailures("openai", policy)).toEqual([
			"blockedProviders",
		]);
	});

	it("fails closed with noAttestation when no attestation is on file", () => {
		expect(getAttestationComplianceFailures(null, { enabled: true })).toEqual([
			"noAttestation",
		]);
		expect(getAttestationComplianceFailures(null, { enabled: false })).toEqual(
			[],
		);
	});

	it("reports unmet requirements from an attestation", () => {
		const attestation: ProviderComplianceAttestation = {
			soc2: 2,
			promptLogging: null,
			headquarters: "US",
		};
		expect(
			getAttestationComplianceFailures(attestation, {
				enabled: true,
				requireSoc2Type2: true,
				blockPromptLogging: true,
				requireGdpr: true,
			}),
		).toEqual(["requireGdpr", "blockPromptLogging"]);
	});

	it("stays consistent with the boolean predicates for the whole catalogue", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			requireSoc2OrIso27001: true,
			blockApiTraining: true,
			allowedCountries: ["US", "FR"],
			blockedProviders: ["openai"],
		};
		for (const provider of providers) {
			expect(getProviderComplianceFailures(provider, policy).length === 0).toBe(
				isProviderCompliant(provider, policy),
			);
		}
	});
});

describe("blockStealthProviders", () => {
	const stealth: ProviderDefinition = {
		id: "stealthy",
		name: "Stealthy",
		description: "",
		forwardsSafetyIdentifier: false,
		env: { required: { apiKey: "TEST", baseUrl: "TEST_BASE_URL" } },
		legalEntity: null,
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			soc2: 2,
			iso27001: true,
			gdpr: true,
		},
		headquarters: "US",
	};

	it("blocks stealth providers that satisfy every other requirement", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			blockStealthProviders: true,
		};
		expect(getProviderComplianceFailures(stealth, policy)).toEqual([
			"blockStealthProviders",
		]);
		expect(isProviderCompliant(stealth, policy)).toBe(false);
	});

	it("leaves stealth providers alone when the toggle is off or the policy is disabled", () => {
		expect(getProviderComplianceFailures(stealth, { enabled: true })).toEqual(
			[],
		);
		expect(
			getProviderComplianceFailures(stealth, {
				enabled: false,
				blockStealthProviders: true,
			}),
		).toEqual([]);
	});

	it("does not affect non-stealth providers", () => {
		expect(
			getProviderComplianceFailures(makeProvider(stealth.dataPolicy, "US"), {
				enabled: true,
				blockStealthProviders: true,
			}),
		).toEqual([]);
	});

	it("blocks every catalogue stealth provider", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			blockStealthProviders: true,
		};
		const stealthProviders = providers.filter(isStealthProvider);
		expect(stealthProviders.length).toBeGreaterThan(0);
		for (const provider of stealthProviders) {
			expect(getProviderComplianceFailures(provider, policy)).toContain(
				"blockStealthProviders",
			);
		}
	});

	it("does not apply to custom-provider attestations", () => {
		const attestation: ProviderComplianceAttestation = {
			soc2: 2,
			apiTraining: false,
			promptLogging: false,
			headquarters: "US",
		};
		expect(
			getAttestationComplianceFailures(attestation, {
				enabled: true,
				blockStealthProviders: true,
			}),
		).toEqual([]);
	});
});
