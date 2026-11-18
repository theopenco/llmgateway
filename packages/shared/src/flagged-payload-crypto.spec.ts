import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getSecretKeyId } from "./api-key-hash.js";
import {
	decryptFlaggedPayload,
	encryptFlaggedPayload,
} from "./flagged-payload-crypto.js";
import { encryptProviderKey } from "./provider-key-crypto.js";

const ENV_VAR = "GATEWAY_API_KEY_HASH_SECRET";
const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const PLAINTEXT = JSON.stringify({ version: 1, messages: [{ role: "user" }] });

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("flagged payload encryption", () => {
	it("round-trips and never stores the plaintext", () => {
		vi.stubEnv(ENV_VAR, KEY_A);
		const ciphertext = encryptFlaggedPayload(PLAINTEXT, "row-1", "org-1");
		expect(ciphertext.startsWith(`llmgw:cfp1:${getSecretKeyId(KEY_A)}:`)).toBe(
			true,
		);
		expect(ciphertext.includes("messages")).toBe(false);
		expect(decryptFlaggedPayload(ciphertext, "row-1", "org-1")).toBe(PLAINTEXT);
	});

	it("uses a fresh IV per encryption", () => {
		vi.stubEnv(ENV_VAR, KEY_A);
		expect(encryptFlaggedPayload(PLAINTEXT, "row-1", "org-1")).not.toBe(
			encryptFlaggedPayload(PLAINTEXT, "row-1", "org-1"),
		);
	});

	it("binds the ciphertext to its row and organization", () => {
		vi.stubEnv(ENV_VAR, KEY_A);
		const ciphertext = encryptFlaggedPayload(PLAINTEXT, "row-1", "org-1");
		expect(() => decryptFlaggedPayload(ciphertext, "row-2", "org-1")).toThrow();
		expect(() => decryptFlaggedPayload(ciphertext, "row-1", "org-2")).toThrow();
	});

	it("rejects tampered ciphertext", () => {
		vi.stubEnv(ENV_VAR, KEY_A);
		const parts = encryptFlaggedPayload(PLAINTEXT, "row-1", "org-1").split(":");
		const ct = Buffer.from(parts[4], "base64url");
		ct[0] ^= 1;
		parts[4] = ct.toString("base64url");
		expect(() =>
			decryptFlaggedPayload(parts.join(":"), "row-1", "org-1"),
		).toThrow();
	});

	it("decrypts with a rotated-out secret still in the keyring", () => {
		vi.stubEnv(ENV_VAR, KEY_A);
		const ciphertext = encryptFlaggedPayload(PLAINTEXT, "row-1", "org-1");
		vi.stubEnv(ENV_VAR, `${KEY_B},${KEY_A}`);
		expect(decryptFlaggedPayload(ciphertext, "row-1", "org-1")).toBe(PLAINTEXT);
		vi.stubEnv(ENV_VAR, KEY_B);
		expect(() => decryptFlaggedPayload(ciphertext, "row-1", "org-1")).toThrow(
			/not in the GATEWAY_API_KEY_HASH_SECRET keyring/,
		);
	});

	it("uses a key separate from provider-key encryption", () => {
		vi.stubEnv(ENV_VAR, KEY_A);
		const providerKey = encryptProviderKey(PLAINTEXT, "row-1", "org-1");
		expect(() => decryptFlaggedPayload(providerKey, "row-1", "org-1")).toThrow(
			/unknown ciphertext format/,
		);
		const forged = providerKey.replace("llmgw:v2:", "llmgw:cfp1:");
		expect(() => decryptFlaggedPayload(forged, "row-1", "org-1")).toThrow();
	});
});
