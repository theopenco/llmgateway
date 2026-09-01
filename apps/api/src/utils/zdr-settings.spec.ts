import { describe, expect, it, vi } from "vitest";

import { isZeroDataRetentionEnabled } from "./zdr-settings.js";

vi.mock("@llmgateway/shared/enterprise-license", () => ({
	hasOrganizationEnterpriseAccess: (_id: string, plan: string) =>
		plan === "enterprise",
}));

const policy = { enabled: true, zeroDataRetention: true };

describe("isZeroDataRetentionEnabled", () => {
	it("enables ZDR for entitled organizations", () => {
		expect(
			isZeroDataRetentionEnabled({
				id: "org-id",
				plan: "enterprise",
				providerCompliancePolicy: policy,
			}),
		).toBe(true);
	});

	it("ignores stale ZDR policies without enterprise access", () => {
		expect(
			isZeroDataRetentionEnabled({
				id: "org-id",
				plan: "pro",
				providerCompliancePolicy: policy,
			}),
		).toBe(false);
	});
});
