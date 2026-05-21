import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	_resetProviderKeyCryptoCache,
	decryptProviderKey,
	encryptProviderKey,
	isProviderKeyCiphertext,
	validateProviderKeyEncryptionKey,
} from "./crypto.js";

const ENV_VAR = "PROVIDER_KEY_ENCRYPTION_KEY";

function setMasterKey(value: string | undefined) {
	if (value === undefined) {
		// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
		delete process.env[ENV_VAR];
	} else {
		process.env[ENV_VAR] = value;
	}
	_resetProviderKeyCryptoCache();
}

const ORIGINAL_KEY = process.env[ENV_VAR];
const VALID_KEY_A = randomBytes(32).toString("base64");
const VALID_KEY_B = randomBytes(32).toString("base64");

afterEach(() => {
	setMasterKey(ORIGINAL_KEY);
});

beforeEach(() => {
	setMasterKey(VALID_KEY_A);
});

describe("validateProviderKeyEncryptionKey", () => {
	it("accepts a valid 32-byte base64 key", () => {
		expect(() => validateProviderKeyEncryptionKey()).not.toThrow();
	});

	it("throws when env var is missing", () => {
		setMasterKey(undefined);
		expect(() => validateProviderKeyEncryptionKey()).toThrow(
			/PROVIDER_KEY_ENCRYPTION_KEY is not set/,
		);
	});

	it("throws when env var is the wrong length", () => {
		setMasterKey(Buffer.from("too-short").toString("base64"));
		expect(() => validateProviderKeyEncryptionKey()).toThrow(
			/must decode to exactly 32 bytes/,
		);
	});

	it("throws when env var is empty string", () => {
		setMasterKey("");
		expect(() => validateProviderKeyEncryptionKey()).toThrow(
			/PROVIDER_KEY_ENCRYPTION_KEY is not set/,
		);
	});
});

describe("encryptProviderKey / decryptProviderKey", () => {
	it("round-trips a plaintext token", () => {
		const plaintext = "sk-test-abc123def456";
		const ct = encryptProviderKey(plaintext, "row-id-1", "org-1");
		expect(ct.startsWith("llmgw:v1:")).toBe(true);
		expect(decryptProviderKey(ct, "row-id-1", "org-1")).toBe(plaintext);
	});

	it("encrypts the same plaintext to different ciphertexts each call (random IV)", () => {
		const plaintext = "sk-test-stability";
		const seen = new Set<string>();
		for (let i = 0; i < 1000; i++) {
			seen.add(encryptProviderKey(plaintext, "row-id-1", "org-1"));
		}
		expect(seen.size).toBe(1000);
	});

	it("rejects a ciphertext with the wrong row id (AAD mismatch)", () => {
		const ct = encryptProviderKey("sk-test", "row-id-1", "org-1");
		expect(() => decryptProviderKey(ct, "row-id-2", "org-1")).toThrow();
	});

	it("rejects a ciphertext with the wrong organization id (AAD mismatch)", () => {
		const ct = encryptProviderKey("sk-test", "row-id-1", "org-1");
		expect(() => decryptProviderKey(ct, "row-id-1", "org-2")).toThrow();
	});

	it("rejects a tampered ciphertext byte (GCM tag check)", () => {
		const ct = encryptProviderKey("sk-test-tamper", "row-id-1", "org-1");
		const parts = ct.split(":");
		const flipped = Array.from(parts[3]);
		flipped[0] = flipped[0] === "A" ? "B" : "A";
		parts[3] = flipped.join("");
		const tampered = parts.join(":");
		expect(() => decryptProviderKey(tampered, "row-id-1", "org-1")).toThrow();
	});

	it("rejects a tampered auth tag", () => {
		const ct = encryptProviderKey("sk-test-tag", "row-id-1", "org-1");
		const parts = ct.split(":");
		const flipped = Array.from(parts[4]);
		flipped[0] = flipped[0] === "A" ? "B" : "A";
		parts[4] = flipped.join("");
		expect(() =>
			decryptProviderKey(parts.join(":"), "row-id-1", "org-1"),
		).toThrow();
	});

	it("rejects ciphertext encrypted with a different master key", () => {
		const ct = encryptProviderKey("sk-test-key-rotate", "row-id-1", "org-1");
		setMasterKey(VALID_KEY_B);
		expect(() => decryptProviderKey(ct, "row-id-1", "org-1")).toThrow();
	});

	it("rejects an unknown version prefix", () => {
		expect(() =>
			decryptProviderKey("llmgw:v2:aaa:bbb:ccc", "row-id-1", "org-1"),
		).toThrow(/unknown ciphertext version/);
	});

	it("rejects malformed shape (wrong segment count)", () => {
		expect(() =>
			decryptProviderKey("llmgw:v1:onlytwo:parts", "row-id-1", "org-1"),
		).toThrow(/malformed ciphertext/);
	});

	it("rejects malformed shape (no prefix at all)", () => {
		expect(() =>
			decryptProviderKey("not-a-ciphertext", "row-id-1", "org-1"),
		).toThrow(/unknown ciphertext version/);
	});

	it("rejects ciphertext with an invalid IV length", () => {
		const ct = encryptProviderKey("sk-test", "row-id-1", "org-1");
		const parts = ct.split(":");
		// Substitute a too-short iv
		parts[2] = Buffer.from("short").toString("base64url");
		expect(() =>
			decryptProviderKey(parts.join(":"), "row-id-1", "org-1"),
		).toThrow(/invalid iv length/);
	});
});

describe("isProviderKeyCiphertext", () => {
	it("returns true for a real ciphertext", () => {
		const ct = encryptProviderKey("sk-test", "row-id-1", "org-1");
		expect(isProviderKeyCiphertext(ct)).toBe(true);
	});

	it("returns false for plain strings", () => {
		expect(isProviderKeyCiphertext("sk-abc123")).toBe(false);
		expect(isProviderKeyCiphertext("")).toBe(false);
		expect(isProviderKeyCiphertext("llmgw:v2:something")).toBe(false);
	});
});

describe("HKDF data key separation", () => {
	it("produces stable encryption against the same master key", () => {
		// Re-encrypting then decrypting under the same key works across cache resets
		const ct = encryptProviderKey("sk-test-stable", "row-id-1", "org-1");
		_resetProviderKeyCryptoCache();
		expect(decryptProviderKey(ct, "row-id-1", "org-1")).toBe("sk-test-stable");
	});
});
