import { afterEach, describe, expect, it, vi } from "vitest";

import { getTestOptions } from "./testing.js";

describe("scoped e2e options", () => {
	afterEach(() => vi.unstubAllEnvs());

	it.each(["true", undefined])("skips fixed-model cases with CI=%s", (ci) => {
		vi.stubEnv("CI", ci);
		vi.stubEnv("TEST_MODELS", "novita/glm-5.3-flash");
		expect(getTestOptions({ completions: false }).skip).toBe(true);
		expect(getTestOptions().skip).not.toBe(true);
	});

	it("keeps fixed-model cases enabled in unscoped CI", () => {
		vi.stubEnv("CI", "true");
		vi.stubEnv("TEST_MODELS", "");
		expect(getTestOptions({ completions: false })).toEqual({
			retry: 5,
			timeout: 300000,
		});
	});
});
