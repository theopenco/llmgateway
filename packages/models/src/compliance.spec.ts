import { describe, expect, it } from "vitest";

import {
	countryCodeToFlag,
	getProviderCountries,
	getProviderDefinition,
	isProviderCompliant,
	PROVIDER_COUNTRY_NAMES,
	providers,
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
		env: { required: { apiKey: "TEST" } },
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
			consumerTraining: true,
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
					consumerTraining: false,
					promptLogging: false,
				}),
				policy,
			),
		).toBe(true);
		expect(
			isProviderCompliant(
				makeProvider({
					apiTraining: null,
					consumerTraining: null,
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
					consumerTraining: false,
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
					consumerTraining: false,
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
					consumerTraining: false,
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
					consumerTraining: false,
					promptLogging: false,
				}),
				policy,
			),
		).toBe(false);
	});

	it("distinguishes SOC 2 Type 1 from Type 2", () => {
		const type1 = makeProvider({
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			soc2: 1,
		});
		const type2 = makeProvider({
			apiTraining: false,
			consumerTraining: false,
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
			consumerTraining: false,
			promptLogging: false,
		});
		expect(
			isProviderCompliant(none, { enabled: true, requireSoc2Type2: true }),
		).toBe(false);
	});

	it("requireSoc2Type2 blocks a real Type 1 provider (canopywave)", () => {
		// canopywave holds SOC 2 Type 1; it passes requireSoc2 but not requireSoc2Type2.
		const canopywave = getProviderDefinition("canopywave")!;
		expect(canopywave.dataPolicy?.soc2).toBe(1);
		expect(
			isProviderCompliant(canopywave, { enabled: true, requireSoc2: true }),
		).toBe(true);
		expect(
			isProviderCompliant(canopywave, {
				enabled: true,
				requireSoc2Type2: true,
			}),
		).toBe(false);
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
				consumerTraining: false,
				promptLogging: false,
				soc2: 2,
			},
			"US",
		);
		// Same certs, wrong country → blocked.
		const wrongCountry = makeProvider(
			{
				apiTraining: false,
				consumerTraining: false,
				promptLogging: false,
				soc2: 2,
			},
			"CN",
		);
		expect(isProviderCompliant(compliant, policy)).toBe(true);
		expect(isProviderCompliant(wrongCountry, policy)).toBe(false);
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
