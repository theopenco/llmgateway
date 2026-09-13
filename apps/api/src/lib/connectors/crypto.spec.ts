import { afterEach, describe, expect, it, vi } from "vitest";

import { openConnector, sealConnector } from "./crypto.js";

afterEach(() => vi.unstubAllEnvs());

describe("connector encryption", () => {
	it("round-trips credentials without storing plaintext", () => {
		const credentials = {
			access_token: "fixture-access",
			refresh_token: "fixture-refresh",
		};
		const encrypted = sealConnector(credentials, "user", "gmail");
		expect(encrypted).not.toContain("fixture");
		expect(openConnector(encrypted, "user", "gmail")).toEqual(credentials);
		expect(sealConnector(credentials, "user", "gmail")).not.toBe(encrypted);
	});
	it("rejects ciphertext copied between users or connectors", () => {
		const encrypted = sealConnector({ value: "private" }, "user", "gmail");
		expect(() => openConnector(encrypted, "other", "gmail")).toThrow();
		expect(() => openConnector(encrypted, "user", "slack")).toThrow();
		expect(() => openConnector(`${encrypted}x`, "user", "gmail")).toThrow();
	});
	it("supports key rotation and fails when the old key is removed", () => {
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "fixture-old");
		const encrypted = sealConnector({ value: "private" }, "user", "gmail");
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "fixture-new,fixture-old");
		expect(openConnector(encrypted, "user", "gmail")).toEqual({
			value: "private",
		});
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "fixture-new");
		expect(() => openConnector(encrypted, "user", "gmail")).toThrow();
	});
});
