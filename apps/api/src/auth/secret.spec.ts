import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuthSecret } from "./secret.js";

describe("getAuthSecret", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("falls back to the dev secret outside production", () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("AUTH_SECRET", "");
		expect(getAuthSecret()).toBe("dev-secret-key-must-be-32-chars!");
	});

	it("throws in production when unset", () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("AUTH_SECRET", "");
		expect(() => getAuthSecret()).toThrow(/required/);
	});

	it.each([
		"dev-secret-key-must-be-32-chars!",
		"your-secret-key",
		"change-me-to-a-random-32-char-secret",
	])("throws in production for public placeholder %s", (value) => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("AUTH_SECRET", value);
		expect(() => getAuthSecret()).toThrow(/placeholder/);
	});

	it("returns a configured secret in production", () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("AUTH_SECRET", "a-real-random-secret-value-0123456789");
		expect(getAuthSecret()).toBe("a-real-random-secret-value-0123456789");
	});
});
