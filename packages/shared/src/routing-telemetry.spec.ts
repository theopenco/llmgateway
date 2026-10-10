import { describe, expect, it } from "vitest";

import {
	COMPLIANCE_EXCLUSION_REASONS,
	isRoutingExclusionReason,
	ROUTING_EXCLUSION_REASON_LABELS,
	routingExclusionReasonParent,
	toRoutingExclusionReason,
} from "./routing-telemetry.js";

describe("compliance exclusion details", () => {
	it("keeps every compliance rule in the closed vocabulary", () => {
		for (const code of Object.values(COMPLIANCE_EXCLUSION_REASONS)) {
			// A code outside the vocabulary is folded into "other" by the hourly
			// rollup, which would silently erase the breakdown.
			expect(isRoutingExclusionReason(code)).toBe(true);
			expect(toRoutingExclusionReason(code)).toBe(code);
			expect(ROUTING_EXCLUSION_REASON_LABELS[code]).toBeTruthy();
			expect(routingExclusionReasonParent(code)).toBe("compliance");
		}
	});

	it("leaves coarse reasons parentless", () => {
		expect(routingExclusionReasonParent("compliance")).toBeUndefined();
		expect(routingExclusionReasonParent("vision")).toBeUndefined();
	});
});
