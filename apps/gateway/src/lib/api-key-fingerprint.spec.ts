import { afterEach, describe, expect, it } from "vitest";

import { getApiKeyFingerprint } from "./api-key-fingerprint.js";

const originalNodeEnv = process.env.NODE_ENV;
const originalApiKeyHashSecret = process.env.GATEWAY_API_KEY_HASH_SECRET;

describe("api-key-fingerprint", () => {
	afterEach(() => {
		if (originalNodeEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = originalNodeEnv;
		}

		if (originalApiKeyHashSecret === undefined) {
			delete process.env.GATEWAY_API_KEY_HASH_SECRET;
		} else {
			process.env.GATEWAY_API_KEY_HASH_SECRET = originalApiKeyHashSecret;
		}
	});

	it("uses a stable development fallback secret outside production", () => {
		process.env.NODE_ENV = "development";
		delete process.env.GATEWAY_API_KEY_HASH_SECRET;

		const firstHash = getApiKeyFingerprint("provider-token");
		const secondHash = getApiKeyFingerprint("provider-token");

		expect(firstHash).toBe(secondHash);
		expect(firstHash).toHaveLength(64);
	});

	it("changes fingerprints when the configured secret changes", () => {
		process.env.NODE_ENV = "test";
		process.env.GATEWAY_API_KEY_HASH_SECRET = "first-secret";
		const firstHash = getApiKeyFingerprint("provider-token");

		process.env.GATEWAY_API_KEY_HASH_SECRET = "second-secret";
		const secondHash = getApiKeyFingerprint("provider-token");

		expect(firstHash).not.toBe(secondHash);
	});

	it("throws in production when the hash secret is missing", () => {
		process.env.NODE_ENV = "production";
		delete process.env.GATEWAY_API_KEY_HASH_SECRET;

		expect(() => getApiKeyFingerprint("provider-token")).toThrow(
			"GATEWAY_API_KEY_HASH_SECRET is required in production",
		);
	});
});
