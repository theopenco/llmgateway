import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encryptProviderKey } from "./crypto.js";
import {
	providerKeyLabel,
	readProviderKey,
	readProviderKeyMask,
} from "./read.js";

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

function encryptedRow(plaintext: string) {
	return {
		id: ROW_ID,
		organizationId: ORG_ID,
		tokenCiphertext: encryptProviderKey(plaintext, ROW_ID, ORG_ID),
	};
}

describe("readProviderKey", () => {
	it("decrypts the encrypted token", () => {
		const row = encryptedRow("real-encrypted-value");
		expect(readProviderKey(row)).toBe("real-encrypted-value");
	});

	it("throws when ciphertext is tampered", () => {
		const row = encryptedRow("real-value");
		const parts = row.tokenCiphertext.split(":");
		const flipped = Array.from(parts[3]);
		flipped[0] = flipped[0] === "A" ? "B" : "A";
		parts[3] = flipped.join("");
		row.tokenCiphertext = parts.join(":");
		expect(() => readProviderKey(row)).toThrow();
	});

	it("throws on an unknown ciphertext prefix", () => {
		const row = {
			id: ROW_ID,
			organizationId: ORG_ID,
			tokenCiphertext: "llmgw:v3:aaa:bbb:ccc",
		};
		expect(() => readProviderKey(row)).toThrow(/unknown ciphertext version/);
	});

	it("throws when ciphertext is missing", () => {
		expect(() =>
			readProviderKey({
				id: ROW_ID,
				organizationId: ORG_ID,
				tokenCiphertext: null,
			}),
		).toThrow("Provider key ciphertext is missing");
	});
});

describe("readProviderKeyMask", () => {
	it("returns the encrypted key's mask", () => {
		expect(readProviderKeyMask({ tokenMasked: "sk-live-1234•••••" })).toBe(
			"sk-live-1234•••••",
		);
	});

	it("throws when the mask is missing", () => {
		expect(() => readProviderKeyMask({ tokenMasked: null })).toThrow(
			"Provider key mask is missing",
		);
	});
});

describe("providerKeyLabel", () => {
	it("prefers the key's description", () => {
		expect(
			providerKeyLabel({
				organizationId: ORG_ID,
				managed: false,
				description: "Production workloads",
				name: "prod-openai",
				tokenMasked: "sk-live-1234•••••",
			}),
		).toBe("Production workloads");
	});

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
				description: "Internal account description",
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
