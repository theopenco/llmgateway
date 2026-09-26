import { describe, expect, it, vi } from "vitest";

import { resolveSeatLimit } from "./seat-limit.js";

vi.mock("@llmgateway/shared/enterprise-license", () => ({
	hasOrganizationEnterpriseAccess: () => false,
}));

describe("resolveSeatLimit", () => {
	it("honors an explicit override without enterprise access", () => {
		expect(resolveSeatLimit("test-org", "enterprise", 12)).toBe(12);
	});
	it("uses the ordinary default without an override or enterprise access", () => {
		expect(resolveSeatLimit("test-org", "enterprise", null)).toBe(5);
	});
});
