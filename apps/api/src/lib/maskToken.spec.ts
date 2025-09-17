import { describe, expect, it } from "vitest";

import { maskToken } from "./maskToken.js";

describe("maskToken", () => {
	it("masks all characters after the visible ones", () => {
		const masked = maskToken("12345678901234567890", 12);
		expect(masked).toBe("123456789012••••••••");
	});

	it("handles tokens shorter than visible length", () => {
		const masked = maskToken("12345", 10);
		expect(masked).toBe("12345");
	});
});
