import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _resetProviderKeyCryptoCache, encryptProviderKey } from "./crypto.js";
import { hasProviderKey, readProviderKey } from "./read.js";

import type { ProviderKeyRowLike } from "./read.js";

const ENV_VAR = "PROVIDER_KEY_ENCRYPTION_KEY";
const ORIGINAL_KEY = process.env[ENV_VAR];
const VALID_KEY = randomBytes(32).toString("base64");

beforeEach(() => {
	process.env[ENV_VAR] = VALID_KEY;
	_resetProviderKeyCryptoCache();
});

afterEach(() => {
	if (ORIGINAL_KEY === undefined) {
		// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
		delete process.env[ENV_VAR];
	} else {
		process.env[ENV_VAR] = ORIGINAL_KEY;
	}
	_resetProviderKeyCryptoCache();
});

const ROW_ID = "row-abc";
const ORG_ID = "org-xyz";

function legacyRow(token: string | null) {
	return { id: ROW_ID, organizationId: ORG_ID, token, tokenCiphertext: null };
}

function encryptedRow(plaintext: string, alsoSetToken: string | null = null) {
	return {
		id: ROW_ID,
		organizationId: ORG_ID,
		token: alsoSetToken,
		tokenCiphertext: encryptProviderKey(plaintext, ROW_ID, ORG_ID),
	};
}

describe("readProviderKey", () => {
	it("returns legacy plaintext when tokenCiphertext is null", () => {
		expect(readProviderKey(legacyRow("legacy-plaintext-value"))).toBe(
			"legacy-plaintext-value",
		);
	});

	it("decrypts when tokenCiphertext is set, ignoring the legacy token column", () => {
		const row = encryptedRow("real-encrypted-value", "ATTACKER_PLAINTEXT");
		expect(readProviderKey(row)).toBe("real-encrypted-value");
	});

	it("does NOT fall back to legacy token when ciphertext is tampered", () => {
		const row = encryptedRow("real-value", "would-be-fallback");
		const parts = row.tokenCiphertext.split(":");
		const flipped = Array.from(parts[3]);
		flipped[0] = flipped[0] === "A" ? "B" : "A";
		parts[3] = flipped.join("");
		row.tokenCiphertext = parts.join(":");
		expect(() => readProviderKey(row)).toThrow();
	});

	it("throws when both columns are null", () => {
		expect(() => readProviderKey(legacyRow(null))).toThrow(
			/no token available/,
		);
	});

	it("throws on unknown ciphertext prefix even if token is set", () => {
		const row = {
			id: ROW_ID,
			organizationId: ORG_ID,
			token: "fallback-not-allowed",
			tokenCiphertext: "llmgw:v2:aaa:bbb:ccc",
		};
		expect(() => readProviderKey(row)).toThrow(/unknown ciphertext version/);
	});

	it("treats absent tokenCiphertext field as legacy (stale SWR mirror)", () => {
		// Simulate a row deserialized from an SWR mirror written before this
		// PR shipped: the tokenCiphertext property is missing entirely, not
		// just null. Must still go down the legacy path.
		const staleCachedRow = {
			id: ROW_ID,
			organizationId: ORG_ID,
			token: "pre-byok-plaintext",
		} as ProviderKeyRowLike;
		expect(readProviderKey(staleCachedRow)).toBe("pre-byok-plaintext");
	});

	it("throws when both ciphertext and token fields are absent (stale cache + no token)", () => {
		const empty = { id: ROW_ID, organizationId: ORG_ID } as ProviderKeyRowLike;
		expect(() => readProviderKey(empty)).toThrow(/no token available/);
	});
});

describe("hasProviderKey", () => {
	it("returns false for null row", () => {
		expect(hasProviderKey(null)).toBe(false);
		expect(hasProviderKey(undefined)).toBe(false);
	});

	it("returns false for a row with no token material", () => {
		expect(hasProviderKey(legacyRow(null))).toBe(false);
	});

	it("returns true for a legacy plaintext row", () => {
		expect(hasProviderKey(legacyRow("anything"))).toBe(true);
	});

	it("returns true for an encrypted row", () => {
		expect(hasProviderKey(encryptedRow("anything"))).toBe(true);
	});

	it("never decrypts (works with garbage ciphertext)", () => {
		// Even malformed ciphertext is truthy — by design, no decrypt cost.
		expect(
			hasProviderKey({
				id: ROW_ID,
				organizationId: ORG_ID,
				token: null,
				tokenCiphertext: "obviously-not-a-valid-ciphertext",
			}),
		).toBe(true);
	});

	it("treats absent tokenCiphertext field as legacy (stale SWR mirror)", () => {
		const staleCachedRow = {
			id: ROW_ID,
			organizationId: ORG_ID,
			token: "anything",
		} as ProviderKeyRowLike;
		expect(hasProviderKey(staleCachedRow)).toBe(true);
	});

	it("returns false when both fields are absent (empty stale row)", () => {
		const empty = { id: ROW_ID, organizationId: ORG_ID } as ProviderKeyRowLike;
		expect(hasProviderKey(empty)).toBe(false);
	});
});
