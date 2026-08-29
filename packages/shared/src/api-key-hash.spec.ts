import { afterEach, describe, expect, it } from "vitest";

import {
	getApiKeyFingerprint,
	getApiKeyFingerprints,
	getApiKeyHashSecret,
	getApiKeyHashSecrets,
	getSecretKeyId,
	hashApiKeyForStorage,
	hashTokenForStorage,
} from "./api-key-hash.js";

const ENV_VAR = "GATEWAY_API_KEY_HASH_SECRET";
const ORIGINAL_SECRET = process.env[ENV_VAR];
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setSecret(value: string | undefined) {
	if (value === undefined) {
		// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
		delete process.env[ENV_VAR];
	} else {
		process.env[ENV_VAR] = value;
	}
}

afterEach(() => {
	setSecret(ORIGINAL_SECRET);
	process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("getApiKeyHashSecrets", () => {
	it("returns a single-entry keyring for a plain secret", () => {
		setSecret("secret-a");
		expect(getApiKeyHashSecrets()).toEqual(["secret-a"]);
	});

	it("splits a comma-separated keyring, newest first", () => {
		setSecret("secret-new,secret-old");
		expect(getApiKeyHashSecrets()).toEqual(["secret-new", "secret-old"]);
	});

	it("trims whitespace and drops empty entries", () => {
		setSecret(" secret-new , secret-old ,, ");
		expect(getApiKeyHashSecrets()).toEqual(["secret-new", "secret-old"]);
	});

	it("falls back to the dev secret outside production", () => {
		setSecret(undefined);
		expect(getApiKeyHashSecrets()).toEqual([
			"llmgateway-dev-api-key-hash-secret",
		]);
	});

	it("throws in production when unset or effectively empty", () => {
		process.env.NODE_ENV = "production";
		setSecret(undefined);
		expect(() => getApiKeyHashSecrets()).toThrow(/required in production/);
		setSecret(" , ");
		expect(() => getApiKeyHashSecrets()).toThrow(/required in production/);
	});
});

describe("getApiKeyHashSecret / getApiKeyFingerprint", () => {
	it("uses the first keyring entry as the current secret", () => {
		setSecret("secret-new,secret-old");
		expect(getApiKeyHashSecret()).toBe("secret-new");
	});

	it("computes fingerprints with the current secret only", () => {
		setSecret("secret-new");
		const current = getApiKeyFingerprint("llmgtwy_token");
		setSecret("secret-new,secret-old");
		expect(getApiKeyFingerprint("llmgtwy_token")).toBe(current);
		setSecret("secret-old");
		expect(getApiKeyFingerprint("llmgtwy_token")).not.toBe(current);
	});

	it("computes lookup fingerprints for the full keyring", () => {
		setSecret("secret-new,secret-old");
		const fingerprints = getApiKeyFingerprints("llmgtwy_token");
		expect(fingerprints).toHaveLength(2);
		expect(fingerprints[0]).toBe(getApiKeyFingerprint("llmgtwy_token"));
		setSecret("secret-old");
		expect(fingerprints[1]).toBe(getApiKeyFingerprint("llmgtwy_token"));
	});

	it("builds hash-only storage values", () => {
		setSecret("secret-new");
		expect(hashApiKeyForStorage("llmgtwy_secret-value")).toEqual({
			tokenHash: getApiKeyFingerprint("llmgtwy_secret-value"),
			tokenMasked: "llmgtwy_secr•••••",
		});
	});

	it("builds hash-only values without API-key display metadata", () => {
		setSecret("secret-new");
		expect(hashTokenForStorage("es_session-secret")).toEqual({
			tokenHash: getApiKeyFingerprint("es_session-secret"),
		});
	});
});

describe("getSecretKeyId", () => {
	it("is stable for the same secret and 8 hex chars long", () => {
		expect(getSecretKeyId("secret-a")).toBe(getSecretKeyId("secret-a"));
		expect(getSecretKeyId("secret-a")).toMatch(/^[0-9a-f]{8}$/);
	});

	it("differs across secrets and never echoes the secret", () => {
		expect(getSecretKeyId("secret-a")).not.toBe(getSecretKeyId("secret-b"));
		expect(getSecretKeyId("secret-a")).not.toContain("secret-a");
	});
});
