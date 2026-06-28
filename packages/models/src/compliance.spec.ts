import { describe, expect, it } from "vitest";

import {
	getProviderDefinition,
	isProviderCompliant,
	type ProviderCompliancePolicy,
	type ProviderDefinition,
} from "./providers.js";

function makeProvider(
	dataPolicy: ProviderDefinition["dataPolicy"],
): ProviderDefinition {
	return {
		id: "test",
		name: "Test",
		description: "",
		env: { required: { apiKey: "TEST" } },
		dataPolicy,
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
			soc2: true,
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
					soc2: true,
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
});
