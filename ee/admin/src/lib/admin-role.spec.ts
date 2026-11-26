import { describe, expect, test } from "vitest";

import { canReadFinancials, canRefund, canWrite } from "./admin-role";

describe("admin role capabilities", () => {
	test.each([
		{ role: "admin", financials: true, write: true, refund: true },
		{ role: "viewer", financials: true, write: false, refund: false },
		{ role: "support", financials: false, write: false, refund: true },
		{ role: null, financials: false, write: false, refund: false },
	] as const)(
		"keeps $role capabilities separate",
		({ role, financials, write, refund }) => {
			expect(canReadFinancials(role)).toBe(financials);
			expect(canWrite(role)).toBe(write);
			expect(canRefund(role)).toBe(refund);
		},
	);
});
