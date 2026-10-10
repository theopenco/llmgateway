import { describe, expect, it } from "vitest";

import { formatErrorRate } from "./format-error-rate";

describe("formatErrorRate", () => {
	it("renders a missing rate as a dash, not 0%", () => {
		expect(formatErrorRate(null)).toBe("—");
		expect(formatErrorRate(undefined)).toBe("—");
		expect(formatErrorRate(0)).toBe("0%");
	});

	it("keeps precision for small rates", () => {
		expect(formatErrorRate(0.00004)).toBe("<0.01%");
		expect(formatErrorRate(0.0004)).toBe("0.04%");
		expect(formatErrorRate(0.0525)).toBe("5.25%");
		expect(formatErrorRate(0.8)).toBe("80.0%");
	});
});
