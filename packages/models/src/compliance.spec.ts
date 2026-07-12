import { describe, expect, it } from "vitest";

import {
	countryCodeToFlag,
	getProviderCountries,
	getProviderDefinition,
	isProviderCompliant,
	type ProviderCompliancePolicy,
	type ProviderDefinition,
} from "./providers.js";

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

	it("requireSoc2OrIso27001 passes when either certification is present", () => {
		const policy: ProviderCompliancePolicy = {
			enabled: true,
			requireSoc2OrIso27001: true,
		};
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
