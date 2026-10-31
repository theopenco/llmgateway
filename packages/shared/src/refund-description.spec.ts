import { describe, expect, it } from "vitest";

import { buildRefundDescription } from "./refunds.js";

describe("refund descriptions", () => {
	it.each([
		[20, "20", "Refund: DevPass Pro"],
		[5, "20", "Partial refund (25.0%): DevPass Pro"],
		[0.01, "0.03", "Partial refund (33.3%): DevPass Pro"],
		[0.3, "0.30", "Refund: DevPass Pro"],
		[5, null, "Refund: DevPass Pro"],
	])("formats refund %s of %s", (refund, amount, expected) => {
		expect(
			buildRefundDescription(refund, { amount, description: "DevPass Pro" }),
		).toBe(expected);
	});
	it("uses a neutral label for an unnamed purchase", () => {
		expect(buildRefundDescription(5, { amount: "20", description: " " })).toBe(
			"Partial refund (25.0%): original purchase",
		);
	});
	it("preserves stored information when the purchase is missing", () => {
		expect(buildRefundDescription(5, undefined, "Legacy partial refund")).toBe(
			"Legacy partial refund",
		);
		expect(buildRefundDescription(5, undefined)).toBe(
			"Refund: original purchase",
		);
	});
});
