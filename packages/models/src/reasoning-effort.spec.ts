import { describe, expect, it } from "vitest";

import { nearestReasoningEffort } from "./reasoning-effort.js";

describe("nearestReasoningEffort", () => {
	it("keeps a supported or undeclared effort", () => {
		expect(nearestReasoningEffort("high", ["low", "high"])).toBe("high");
		expect(nearestReasoningEffort("xhigh", undefined)).toBe("xhigh");
		expect(nearestReasoningEffort("xhigh", [])).toBe("xhigh");
	});

	it("clamps to the closest declared tier", () => {
		expect(nearestReasoningEffort("xhigh", ["low", "medium", "high"])).toBe(
			"high",
		);
		expect(nearestReasoningEffort("max", ["low", "medium", "high"])).toBe(
			"high",
		);
		expect(nearestReasoningEffort("minimal", ["low", "high"])).toBe("low");
	});

	it("prefers the higher tier on a tie", () => {
		expect(nearestReasoningEffort("medium", ["low", "high"])).toBe("high");
	});

	it("only picks none when none was asked for", () => {
		expect(nearestReasoningEffort("minimal", ["none", "medium"])).toBe(
			"medium",
		);
		expect(nearestReasoningEffort("none", ["low", "high"])).toBe("none");
		expect(nearestReasoningEffort("low", ["none"])).toBe("low");
	});
});
