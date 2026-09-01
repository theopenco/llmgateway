import { describe, expect, it } from "vitest";

import { isZeroDataRetentionEnabled } from "./zdr-settings.js";

const policy = { enabled: true, zeroDataRetention: true };

describe("isZeroDataRetentionEnabled", () => {
	it("enables an active stored ZDR policy", () => {
		expect(
			isZeroDataRetentionEnabled({
				providerCompliancePolicy: policy,
			}),
		).toBe(true);
	});

	it("enforces stored ZDR policies without enterprise access", () => {
		expect(
			isZeroDataRetentionEnabled({
				providerCompliancePolicy: policy,
			}),
		).toBe(true);
	});
});
