import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	decryptProviderKey,
	encryptProviderKey,
	isProviderKeyCiphertext,
} from "./crypto.js";

const ENV_VAR = "GATEWAY_API_KEY_HASH_SECRET";

function setMasterKey(value: string | undefined) {
	if (value === undefined) {
		// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
		delete process.env[ENV_VAR];
	} else {
		process.env[ENV_VAR] = value;
	}
}

const ORIGINAL_KEY = process.env[ENV_VAR];
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const VALID_KEY_A = randomBytes(32).toString("base64");
const VALID_KEY_B = randomBytes(32).toString("base64");

afterEach(() => {
	setMasterKey(ORIGINAL_KEY);
	process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

beforeEach(() => {
	setMasterKey(VALID_KEY_A);
});

describe("master secret resolution", () => {
	it("works without the env var outside production (dev fallback)", () => {
		setMasterKey(undefined);
		const ct = encryptProviderKey("sk-dev-fallback", "row-id-1", "org-1");
		expect(decryptProviderKey(ct, "row-id-1", "org-1")).toBe("sk-dev-fallback");
	});

	it("throws when the secret is missing in production", () => {
		setMasterKey(undefined);
		process.env.NODE_ENV = "production";
		expect(() => encryptProviderKey("sk-test", "row-id-1", "org-1")).toThrow(
			/GATEWAY_API_KEY_HASH_SECRET is required in production/,
		);
	});

	it("throws when the secret is an empty string in production", () => {
		setMasterKey("");
		process.env.NODE_ENV = "production";
		expect(() => encryptProviderKey("sk-test", "row-id-1", "org-1")).toThrow(
			/GATEWAY_API_KEY_HASH_SECRET is required in production/,
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
	it("derives a data key distinct from the raw hash secret", () => {
		const ct = encryptProviderKey("sk-test-stable", "row-id-1", "org-1");
		expect(ct).not.toContain(VALID_KEY_A);
		expect(decryptProviderKey(ct, "row-id-1", "org-1")).toBe("sk-test-stable");
	});
});
