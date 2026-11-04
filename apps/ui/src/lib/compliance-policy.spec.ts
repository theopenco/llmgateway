import { describe, expect, it } from "vitest";

import {
	compliancePolicyForSave,
	hasEnterpriseComplianceRules,
} from "./compliance-policy";

describe("downgraded compliance policies", () => {
	it("does not silently discard active saved restrictions", () => {
		const policy = {
			enabled: true,
			requireGdpr: true,
			blockedProviders: ["openai"],
			requireSoc2: true,
		};
		expect(hasEnterpriseComplianceRules(policy)).toBe(true);
		expect(compliancePolicyForSave(policy, false)).toBeUndefined();
		expect(policy.blockedProviders).toEqual(["openai"]);
		expect(compliancePolicyForSave(policy, true)).toBe(policy);
	});
	it("allows an explicit disable before replacing inherited rules", () => {
		expect(
			compliancePolicyForSave(
				{ enabled: false, requireGdpr: true, blockedProviders: ["openai"] },
				false,
			),
		).toMatchObject({ enabled: false, requireGdpr: true });
		expect(
			compliancePolicyForSave(
				{
					enabled: true,
					requireGdpr: true,
					requireSoc2: false,
					blockedProviders: [],
				},
				false,
			),
		).toMatchObject({ enabled: true, requireGdpr: true });
	});
});
