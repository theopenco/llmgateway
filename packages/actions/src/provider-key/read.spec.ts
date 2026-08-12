import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encryptProviderKey } from "./crypto.js";
import { hasProviderKey, providerKeyLabel, readProviderKey } from "./read.js";

import type { ProviderKeyRowLike } from "./read.js";

const ENV_VAR = "GATEWAY_API_KEY_HASH_SECRET";
const ORIGINAL_KEY = process.env[ENV_VAR];
const VALID_KEY = randomBytes(32).toString("base64");

beforeEach(() => {
	process.env[ENV_VAR] = VALID_KEY;
});

afterEach(() => {
	if (ORIGINAL_KEY === undefined) {
		// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
		delete process.env[ENV_VAR];
	} else {
		process.env[ENV_VAR] = ORIGINAL_KEY;
	}
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
			tokenCiphertext: "llmgw:v3:aaa:bbb:ccc",
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

describe("providerKeyLabel", () => {
	it("prefers the key's name", () => {
		expect(
			providerKeyLabel({
				organizationId: ORG_ID,
				managed: false,
				name: "prod-openai",
				tokenMasked: "sk-live-1234•••••",
			}),
		).toBe("prod-openai");
	});

	it("falls back to the masked token when the key is unnamed", () => {
		expect(
			providerKeyLabel({
				organizationId: ORG_ID,
				managed: false,
				name: null,
				tokenMasked: "sk-live-1234•••••",
			}),
		).toBe("sk-live-1234•••••");
	});

	it("returns undefined for a legacy row with neither", () => {
		expect(
			providerKeyLabel({ organizationId: ORG_ID, managed: false }),
		).toBeUndefined();
	});

	// The whole point of this helper: a platform-managed credential is LLM
	// Gateway's own key. Its name and mask are operator-only and must never be
	// described to a tenant, however the row reaches this function.
	it("never describes a platform-managed credential", () => {
		expect(
			providerKeyLabel({
				organizationId: null,
				managed: true,
				name: "shared-openai-pool-3",
				tokenMasked: "sk-platform-99•••••",
			}),
		).toBeUndefined();
	});

	it("never describes an org-less row even if it is not flagged managed", () => {
		expect(
			providerKeyLabel({
				organizationId: null,
				managed: false,
				name: "shared-openai-pool-3",
			}),
		).toBeUndefined();
	});

	it("returns undefined for a missing row", () => {
		expect(providerKeyLabel(null)).toBeUndefined();
		expect(providerKeyLabel(undefined)).toBeUndefined();
	});
});
